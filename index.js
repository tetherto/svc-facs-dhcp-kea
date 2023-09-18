'use strict'

const BaseFacility = require('bfx-facs-base')
const async = require('async')
const { TaskQueue } = require('@bitfinex/lib-js-util-task-queue')
const debug = require('debug')('facs:kea')

class KEAFacility extends BaseFacility {
  constructor (caller, opts, ctx) {
    super(caller, opts, ctx)
    this.name = 'kea'
    this._hasConf = true
    this.leases = []
    super.init()
    this.taskQueue = new TaskQueue(1)

    if (!this.opts.fac_http) {
      throw new Error('ERR_FAC_HTTP_NOTFOUND')
    }

    this.fac_http = this.opts.fac_http
  }

  async _prepareLeases () {
    if (this.taskQueue.queue.idle()) {
      await this.fetchConf()
      await this.fetchLeases()
    }
  }

  async sendCommand (command, service, args = undefined) {
    const body = {
      command,
      service
    }
    if (args) {
      body.arguments = args
    }
    const data = await this.fac_http.post(this.conf.url, { body, encoding: 'json' })
    return { data: data.body }
  }

  async fetchConf () {
    this.serverConf = (await this.sendCommand('config-get', ['dhcp4'])).data[0].arguments.Dhcp4
    this.subnets = this.serverConf.subnet4
  }

  async sendMultipleCommands (command, service, args, maxParallel = 10) {
    const responses = {
      success: [],
      error: []
    }
    await async.parallelLimit(args.map((val, index) => {
      return async () => {
        try {
          const res = await this.sendCommand(command, service, val)
          if (res.data[0].result === 0) {
            responses.success.push({ index, res: res.data[0], val })
          } else {
            responses.error.push({ index, res: res.data[0] })
          }
        } catch (error) {
          console.error(error)
          responses.error.push({ index, error })
        }
      }
    }
    ), maxParallel)
    return responses
  }

  _addJob (request) {
    return this.taskQueue.pushTask(async () => {
      try {
        const response = await request.process()
        return {
          success: true,
          request: request.payload,
          response: (request.respKey ? { [request.respKey]: response } : {})

        }
      } catch (error) {
        return {
          success: false,
          request: request.payload,
          error: error.message
        }
      }
    })
  }

  async _lease4GetAll () {
    try {
      const res = await this.sendCommand('lease4-get-all', ['dhcp4'])

      if (!res.data[0].arguments) {
        return res.data[0].text
      }

      return res.data[0].arguments.leases
    } catch (error) {
      console.error(error)
    }
  }

  async _lease4set () {
    try {
      const res = await this.sendCommand('lease4-get-all', ['dhcp4'])
      return res.data[0].arguments.leases
    } catch (error) {
      console.error(error)
    }
  }

  async fetchLeases () {
    const res = await this._lease4GetAll()
    this.leases = res.map((val) => ({ mac: val['hw-address'], ip: val['ip-address'], subnetId: val['subnet-id'] }))
  }

  async setLeases (leases) {
    const args = leases.map(lease => ({ 'ip-address': lease.ip, 'hw-address': lease.mac, 'subnet-id': lease.subnetId }))
    const response = await this.sendMultipleCommands('lease4-add', ['dhcp4'], args)
    response.success.forEach((res) => {
      const val = res.val
      this.leases.push({ mac: val['hw-address'], ip: val['ip-address'], subnetId: val['subnet-id'] })
    })
    return response
  }

  async freeLeases (leases) {
    const args = leases.map(lease => ({ 'ip-address': lease.ip, 'hw-address': lease.mac }))
    const response = await this.sendMultipleCommands('lease4-del', ['dhcp4'], args)
    response.success.forEach((res) => {
      const val = res.val
      this.leases = this.leases.filter((lease) => !(lease.mac === val['hw-address'] && lease.ip === val['ip-address']))
    })
  }

  async getSubnetId (subnet) {
    const subnetObj = this.subnets.find((val) => val.subnet === subnet)
    if (subnetObj) {
      return subnetObj.id
    }
    return null
  }

  async getAvailableIp (subnetId) {
    const subnet = this.subnets.find((val) => val.id === subnetId)
    if (!subnet) {
      throw new Error('Invalid subnetId')
    }

    this.fetchLeases()
    const leasesInSubnet = this.leases.filter((val) => val.subnetId === subnetId)
    const allocatedIps = leasesInSubnet.map((val) => val.ip)
    allocatedIps.push(subnet.subnet.split('/')[0])

    const ipRange = this.getIpsInSubnet(subnet.subnet, subnet.pools)
    const availableIps = ipRange.filter((val) => !allocatedIps.includes(val))

    if (availableIps.length === 0) {
      throw new Error('No available ip')
    }

    return availableIps[0]
  }

  getIpsInSubnet (subnetCIDR, pools) {
    const [subnet, prefixLength] = subnetCIDR.split('/')

    const ipParts = subnet.split('.').map(Number)
    const prefix = parseInt(prefixLength, 10)

    const subnetNumeric = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3]

    const numAddresses = 2 ** (32 - prefix)
    const networkNumeric = subnetNumeric & ((2 ** 32 - 1) << (32 - prefix))

    const usableIPs = []
    for (let i = 2; i < numAddresses - 2; i++) {
      const numericIP = networkNumeric + i
      const ipAddress = [
        (numericIP >>> 24) & 255,
        (numericIP >>> 16) & 255,
        (numericIP >>> 8) & 255,
        numericIP & 255
      ].join('.')
      if (pools.length > 0 && !this.isIpInPools(ipAddress, pools)) {
        continue
      }
      usableIPs.push(ipAddress)
    }
    return usableIPs
  }

  isIpInPools (ip, pools) {
    for (let i = 0; i < pools.length; i++) {
      if (this.isIpInPool(ip, pools[i].pool)) return true
    }
    return false
  }

  isIpInPool (ip, pool) {
    const [startIP, endIP] = pool.split('-')

    const startIPArray = startIP.split('.').map(Number)
    const endIPArray = endIP.split('.').map(Number)
    const ipArray = ip.split('.').map(Number)

    for (let i = 0; i < 4; i++) {
      if (ipArray[i] < startIPArray[i] || ipArray[i] > endIPArray[i]) {
        return false
      }
    }
    return true
  }

  async _setIp ({ mac, subnet }) {
    debug('setIp', mac, subnet)
    if (!mac || !subnet) {
      throw new Error('ERR_MAC_AND_SUBNET_REQUIRED')
    }
    const subnetId = await this.getSubnetId(subnet)
    debug('subnetId', subnetId)
    if (!subnetId) {
      debug('subnet not found', subnet)
      throw new Error('ERR_SUBNET_NOT_FOUND')
    }
    const lease = this.leases.find(l => l.mac.toLowerCase() === mac.toLowerCase())
    debug('lease', lease)
    if (lease) {
      debug('lease found')
      if (lease.subnetId !== subnetId) {
        debug('ERR_IN_ANOTHER_SUBNET', lease.subnetId, subnetId)
        throw new Error('ERR_IN_ANOTHER_SUBNET')
      }
      await this.setLeases([{
        ip: lease.ip,
        mac,
        subnetId
      }])
      debug('returning lease.ip', lease.ip)
      return lease.ip
    }

    const ip = await this.getAvailableIp(subnetId)
    if (!ip) {
      debug('ERR_NO_AVAILABLE_IP')
      throw new Error('ERR_NO_AVAILABLE_IP')
    }
    debug('ip found', ip)
    await this.setLeases([{
      ip,
      mac,
      subnetId
    }])
    return ip
  }

  async _releaseIp ({ ip }) {
    debug('releaseIp', ip)
    if (!ip) {
      debug('ERR_IP_REQUIRED')
      throw new Error('ERR_IP_REQUIRED')
    }
    const lease = this.leases.find(l => l.ip === ip)
    if (!lease) {
      throw new Error('ERR_IP_NOT_FOUND')
    }
    debug('lease found', lease)
    await this.freeLeases([{
      ip: lease.ip,
      mac: lease.mac
    }])
    return 1
  }

  async setIps (reqs) {
    await this._prepareLeases()
    const res = []
    for (let i = 0; i < reqs.length; i++) {
      const req = reqs[i]
      res.push(this._addJob({
        payload: { mac: req.mac },
        respKey: 'ip',
        process: async () => {
          return await this._setIp(req, true)
        }
      }))
    }
    return (await Promise.allSettled(res)).map(r => ({ success: r.value.success, mac: r.value.request.mac, ip: r.value.response, error: r.value.error }))
  }

  async setIp ({ mac, subnet }, retry = false) {
    await this._prepareLeases()
    const jobStatus = await this._addJob({
      payload: { mac },
      respKey: 'ip',
      process: async () => {
        return await this._setIp({ mac, subnet })
      }
    })
    if (!retry || jobStatus.success) {
      if (jobStatus.success) {
        return jobStatus.response.ip
      } else {
        throw new Error(jobStatus.error)
      }
    }
    await this._prepareLeases()
    return this.setIp({ mac, subnet })
  }

  async releaseIp ({ ip }, retry = false) {
    await this._prepareLeases()
    const jobStatus = await this._addJob({
      payload: { ip },
      process: async () => {
        return await this._releaseIp({ ip })
      }
    })
    if (!retry || jobStatus.success) {
      if (jobStatus.success) {
        return 1
      } else {
        throw new Error(jobStatus.error)
      }
    }
    await this._prepareLeases()
    return this.releaseIp({ ip })
  }

  async getLeases () {
    await this._prepareLeases()
    return await this.leases.map((val) => ({ mac: val.mac, ip: val.ip }))
  }

  async releaseIps (reqs) {
    await this._prepareLeases()
    const res = []
    for (let i = 0; i < reqs.length; i++) {
      const req = reqs[i]
      res.push(this._addJob({
        payload: { ip: req.ip },
        process: async () => {
          return await this._releaseIp(req, true)
        }
      }))
    }
    return (await Promise.allSettled(res)).map(r => ({ success: r.value.success, ip: r.value.request.ip, error: r.value.error }))
  }
}

module.exports = KEAFacility

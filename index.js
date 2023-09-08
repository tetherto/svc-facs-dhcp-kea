'use strict'

const BaseFacility = require('bfx-facs-base')
const axios = require('axios').default
const async = require('async')
const getIpRange = require('get-ip-range')

class KEAFacility extends BaseFacility {
  constructor (caller, opts, ctx) {
    super(caller, opts, ctx)
    this.name = 'kea'
    this._hasConf = true
    this.leases = []
    super.init()
  }

  sendCommand (command, service, args = undefined) {
    const body = {
      command,
      service
    }
    if (args) {
      body.arguments = args
    }
    return axios.post(this.conf.url, body)
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

  async _lease4GetAll () {
    try {
      const res = await this.sendCommand('lease4-get-all', ['dhcp4'])
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

  async getLeases () {
    return this.leases
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
    const subnetObj = this.conf.subnets.find((val) => val.subnet === subnet)
    if (subnetObj) {
      return subnetObj.id
    }
    return null
  }

  async getAvailableIp (subnetId) {
    const leases = await this.getLeases()
    const subnet = this.conf.subnets.find((val) => val.id === subnetId)
    if (!subnet) {
      throw new Error('Invalid subnetId')
    }

    const leasesInSubnet = leases.filter((val) => val.subnetId === subnetId)
    const allocatedIps = leasesInSubnet.map((val) => val.ip)
    allocatedIps.push(subnet.subnet.split('/')[0])

    const ipRange = getIpRange.getIPRange(subnet.subnet)
    const availableIps = ipRange.filter((val) => !allocatedIps.includes(val))

    if (availableIps.length === 0) {
      throw new Error('No available ip')
    }

    return availableIps[0]
  }
}

module.exports = KEAFacility

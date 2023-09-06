'use strict'

const BaseFacility = require('bfx-facs-base')
const axios = require('axios').default
const async = require('async')

class KEAFacility extends BaseFacility {
  constructor (caller, opts, ctx) {
    super(caller, opts, ctx)
    this.name = 'kea'
    this._hasConf = true
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
          // responses[index] = res
          if (res.data.result === 0) {
            responses.success.push({ index, res })
          } else {
            responses.error.push({ index, res })
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

  async getLeases () {
    const res = await this._lease4GetAll()
    return res.map((val) => ({ mac: val['hw-address'], ip: val['ip-address'] }))
  }

  async setLeases (leases) {
    // take array of ip,mac objects and set, error on conflict, etc.
    // figure if we need to hot reload the server or automatic, etc.
    const args = leases.map(lease => ({ 'ip-address': lease.ip, 'hw-address': lease.mac }))
    return await this.sendMultipleCommands('lease4-add', ['dhcp4'], args)
  }

  async freeLeases (leases) {
    // take array of ip,mac objects and free, error on conflict, etc.
    // figure if we need to hot reload the server or automatic, etc.
    const args = leases.map(lease => ({ 'ip-address': lease.ip, 'hw-address': lease.mac }))
    return await this.sendMultipleCommands('lease4-del', ['dhcp4'], args)
  }
}

module.exports = KEAFacility

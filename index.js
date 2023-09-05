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

  sendCommand (command, service, args = undefined ) {
    let body = {
      command,
      service
    }
    if(args)
    {
      body.arguments = args
    }
    return axios.post(this.conf.url, body)
  }

  async _lease4GetAll(){
    try {
      const res = await this.sendCommand("lease4-get-all",["dhcp4"])
      return res.data[0].arguments.leases
    } catch (error) {
      console.error(error);
    }
  }

  async _lease4set(){
    try {
      const res = await this.sendCommand("lease4-get-all",["dhcp4"])
      return res.data[0].arguments.leases
    } catch (error) {
      console.error(error);
    }
  }

  async getLeases(){
    const res = await this._lease4GetAll()
    return res.map((val) => ({"mac": val["hw-address"], "ip": val["ip-address"]}))
  }

  async setLeases(leases){
    //take array of ip,mac objects and set, error on conflict, etc.
    //figure if we need to hot reload the server or automatic, etc.
  }

  async freeLeases(leases){
    //take array of ip,mac objects and free, error on conflict, etc.
    //figure if we need to hot reload the server or automatic, etc.
  }

}

module.exports = KEAFacility
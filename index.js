'use strict'

const BaseFacility = require('bfx-facs-base')
const axios = require('axios').default
const async = require('async')

class KEAFacility extends BaseFacility {
  constructor (caller, opts, ctx) {
    super(caller, opts, ctx)
    this.name = 'kea'
    this._hasConf = true
    this.init()
  }

  async keaCall (command, service) {
    body = {
      command,
      service
    }
    return axios.post(this.conf.url, body)
  }

  async getAll(){
    try {
      const res = await this.keaCall
      console.log(res);
    } catch (error) {
      console.error(error);
    }
  }


  _stop (cb) {
    async.series([
      next => { super._stop(next) },
      async () => {
        if (this.server) {
          await this.server.close()
          aedes.close()
        }
      }
    ], cb)
  }
}

module.exports = KEAFacility
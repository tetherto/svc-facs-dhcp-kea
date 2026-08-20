'use strict'

const { test } = require('brittle')
const path = require('path')
const KEAFacility = require('../index')

const createFacility = () => {
  const fac = new KEAFacility(
    { ctx: { root: path.join(__dirname) } },
    { fac_http: { post: async () => ({ body: [] }) }, ns: 'kea' },
    { env: 'test' }
  )
  fac.subnets = []
  return fac
}

// ---------------------------------------------------------------------------
// isIpInPool
// ---------------------------------------------------------------------------

test('isIpInPool - returns true for IP within range', async t => {
  const fac = createFacility()
  t.ok(fac.isIpInPool('192.168.1.15', '192.168.1.10-192.168.1.20'))
})

test('isIpInPool - returns true for IP at start of range', async t => {
  const fac = createFacility()
  t.ok(fac.isIpInPool('192.168.1.10', '192.168.1.10-192.168.1.20'))
})

test('isIpInPool - returns true for IP at end of range', async t => {
  const fac = createFacility()
  t.ok(fac.isIpInPool('192.168.1.20', '192.168.1.10-192.168.1.20'))
})

test('isIpInPool - returns false for IP below range', async t => {
  const fac = createFacility()
  t.absent(fac.isIpInPool('192.168.1.5', '192.168.1.10-192.168.1.20'))
})

test('isIpInPool - returns false for IP above range', async t => {
  const fac = createFacility()
  t.absent(fac.isIpInPool('192.168.1.25', '192.168.1.10-192.168.1.20'))
})

// ---------------------------------------------------------------------------
// isIpInPools
// ---------------------------------------------------------------------------

test('isIpInPools - returns true when IP matches one of multiple pools', async t => {
  const fac = createFacility()
  const pools = [
    { pool: '192.168.1.10-192.168.1.20' },
    { pool: '192.168.1.50-192.168.1.60' }
  ]
  t.ok(fac.isIpInPools('192.168.1.55', pools))
})

test('isIpInPools - returns false when IP matches no pool', async t => {
  const fac = createFacility()
  const pools = [
    { pool: '192.168.1.10-192.168.1.20' },
    { pool: '192.168.1.50-192.168.1.60' }
  ]
  t.absent(fac.isIpInPools('192.168.1.30', pools))
})

test('isIpInPools - returns false for empty pools array', async t => {
  const fac = createFacility()
  t.absent(fac.isIpInPools('192.168.1.15', []))
})

// ---------------------------------------------------------------------------
// getIpsInSubnet
// ---------------------------------------------------------------------------

test('getIpsInSubnet - /24 with no pools returns all usable IPs (.2–.253)', async t => {
  const fac = createFacility()
  const ips = fac.getIpsInSubnet('192.168.1.0/24', [])
  t.is(ips.length, 252)
  t.is(ips[0], '192.168.1.2')
  t.is(ips[ips.length - 1], '192.168.1.253')
})

test('getIpsInSubnet - /24 with pool filters to only pool IPs', async t => {
  const fac = createFacility()
  const pools = [{ pool: '192.168.1.10-192.168.1.15' }]
  const ips = fac.getIpsInSubnet('192.168.1.0/24', pools)
  t.alike(ips, ['192.168.1.10', '192.168.1.11', '192.168.1.12', '192.168.1.13', '192.168.1.14', '192.168.1.15'])
})

test('getIpsInSubnet - /29 with no pools returns 4 host IPs', async t => {
  const fac = createFacility()
  // /29 → 8 addresses, i: 2..5 (i < 8-2=6) → .2 .3 .4 .5
  const ips = fac.getIpsInSubnet('10.0.0.0/29', [])
  t.alike(ips, ['10.0.0.2', '10.0.0.3', '10.0.0.4', '10.0.0.5'])
})

// ---------------------------------------------------------------------------
// getSubnetId
// ---------------------------------------------------------------------------

test('getSubnetId - returns id when subnet found', async t => {
  const fac = createFacility()
  fac.subnets = [
    { id: 1, subnet: '192.168.1.0/24' },
    { id: 2, subnet: '10.0.0.0/24' }
  ]
  t.is(await fac.getSubnetId('10.0.0.0/24'), 2)
})

test('getSubnetId - returns null when subnet not found', async t => {
  const fac = createFacility()
  fac.subnets = [{ id: 1, subnet: '192.168.1.0/24' }]
  t.is(await fac.getSubnetId('10.0.0.0/24'), null)
})

// ---------------------------------------------------------------------------
// fetchLeases
// ---------------------------------------------------------------------------

test('fetchLeases - maps raw kea lease fields to internal format', async t => {
  const fac = createFacility()
  fac._lease4GetAll = async () => [
    { 'hw-address': 'aa:bb:cc:dd:ee:ff', 'ip-address': '192.168.1.10', 'subnet-id': 1 },
    { 'hw-address': '11:22:33:44:55:66', 'ip-address': '192.168.1.11', 'subnet-id': 2 }
  ]
  await fac.fetchLeases()
  t.alike(fac.leases, [
    { mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.10', subnetId: 1 },
    { mac: '11:22:33:44:55:66', ip: '192.168.1.11', subnetId: 2 }
  ])
})

// ---------------------------------------------------------------------------
// setLeases
// ---------------------------------------------------------------------------

test('setLeases - adds successfully added leases to internal state', async t => {
  const fac = createFacility()
  fac.sendMultipleCommands = async () => ({
    success: [{ index: 0, val: { 'hw-address': 'aa:bb:cc:dd:ee:ff', 'ip-address': '192.168.1.10', 'subnet-id': 1 } }],
    error: []
  })
  await fac.setLeases([{ ip: '192.168.1.10', mac: 'aa:bb:cc:dd:ee:ff', subnetId: 1 }])
  t.alike(fac.leases, [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.10', subnetId: 1 }])
})

test('setLeases - does not add failed leases to internal state', async t => {
  const fac = createFacility()
  fac.sendMultipleCommands = async () => ({
    success: [],
    error: [{ index: 0, res: { result: 1 } }]
  })
  await fac.setLeases([{ ip: '192.168.1.10', mac: 'aa:bb:cc:dd:ee:ff', subnetId: 1 }])
  t.alike(fac.leases, [])
})

// ---------------------------------------------------------------------------
// freeLeases
// ---------------------------------------------------------------------------

test('freeLeases - removes released leases from internal state', async t => {
  const fac = createFacility()
  fac.leases = [
    { mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.10', subnetId: 1 },
    { mac: '11:22:33:44:55:66', ip: '192.168.1.11', subnetId: 1 }
  ]
  fac.sendMultipleCommands = async () => ({
    success: [{ index: 0, val: { 'hw-address': 'aa:bb:cc:dd:ee:ff', 'ip-address': '192.168.1.10' } }],
    error: []
  })
  await fac.freeLeases([{ ip: '192.168.1.10', mac: 'aa:bb:cc:dd:ee:ff' }])
  t.alike(fac.leases, [{ mac: '11:22:33:44:55:66', ip: '192.168.1.11', subnetId: 1 }])
})

test('freeLeases - does not remove leases that failed to delete', async t => {
  const fac = createFacility()
  fac.leases = [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.10', subnetId: 1 }]
  fac.sendMultipleCommands = async () => ({ success: [], error: [{ index: 0 }] })
  await fac.freeLeases([{ ip: '192.168.1.10', mac: 'aa:bb:cc:dd:ee:ff' }])
  t.is(fac.leases.length, 1)
})

// ---------------------------------------------------------------------------
// getAvailableIp
// ---------------------------------------------------------------------------

test('getAvailableIp - throws ERR_SUBNET_NOT_FOUND for unknown subnetId', async t => {
  const fac = createFacility()
  fac.subnets = [{ id: 1, subnet: '192.168.1.0/24', pools: [] }]
  fac.fetchLeases = async () => {}
  await t.exception(() => fac.getAvailableIp(99), { message: 'ERR_SUBNET_NOT_FOUND' })
})

test('getAvailableIp - returns first unallocated IP in pool', async t => {
  const fac = createFacility()
  fac.subnets = [{ id: 1, subnet: '192.168.1.0/24', pools: [{ pool: '192.168.1.10-192.168.1.15' }] }]
  fac.leases = [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.10', subnetId: 1 }]
  fac.fetchLeases = async () => {}
  t.is(await fac.getAvailableIp(1), '192.168.1.11')
})

test('getAvailableIp - throws ERR_NO_AVAILABLE_IP when all pool IPs are allocated', async t => {
  const fac = createFacility()
  fac.subnets = [{ id: 1, subnet: '192.168.1.0/24', pools: [{ pool: '192.168.1.10-192.168.1.10' }] }]
  fac.leases = [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.10', subnetId: 1 }]
  fac.fetchLeases = async () => {}
  await t.exception(() => fac.getAvailableIp(1), { message: 'ERR_NO_AVAILABLE_IP' })
})

test('setIp - surfaces ERR_NO_AVAILABLE_IP to the caller when the pool is exhausted', async t => {
  const fac = createFacility()
  fac.subnets = [{ id: 1, subnet: '192.168.1.0/24', pools: [{ pool: '192.168.1.10-192.168.1.10' }] }]
  fac.leases = [{ mac: '11:22:33:44:55:66', ip: '192.168.1.10', subnetId: 1 }]
  fac._prepareLeases = async () => {}
  fac.fetchLeases = async () => {}
  await t.exception(
    () => fac.setIp({ mac: 'aa:bb:cc:dd:ee:ff', subnet: '192.168.1.0/24' }),
    { message: 'ERR_NO_AVAILABLE_IP' }
  )
})

test('getAvailableIp - refreshes leases from kea before choosing an ip', async t => {
  const fac = createFacility()
  fac.subnets = [{ id: 1, subnet: '192.168.1.0/24', pools: [{ pool: '192.168.1.10-192.168.1.15' }] }]
  fac.leases = []
  fac.fetchLeases = async () => {
    await new Promise(resolve => setImmediate(resolve))
    fac.leases = [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.10', subnetId: 1 }]
  }

  const ip = await fac.getAvailableIp(1)

  t.is(fac.leases.length, 1)
  t.is(ip, '192.168.1.11')
})

test('getAvailableIp - does not hand out an ip already leased to another mac', async t => {
  const fac = createFacility()
  fac.subnets = [{ id: 1, subnet: '192.168.1.0/24', pools: [{ pool: '192.168.1.10-192.168.1.15' }] }]
  fac.leases = []
  const kea = [
    { mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.10', subnetId: 1 },
    { mac: '11:22:33:44:55:66', ip: '192.168.1.11', subnetId: 1 }
  ]
  fac.fetchLeases = async () => {
    await new Promise(resolve => setImmediate(resolve))
    fac.leases = kea.slice()
  }

  t.is(await fac.getAvailableIp(1), '192.168.1.12')
})

// ---------------------------------------------------------------------------
// _releaseIp
// ---------------------------------------------------------------------------

test('_releaseIp - throws when ip is not provided', async t => {
  const fac = createFacility()
  await t.exception(() => fac._releaseIp({ ip: null }), { message: 'ERR_IP_REQUIRED' })
})

test('_releaseIp - throws when lease for ip is not found', async t => {
  const fac = createFacility()
  fac.leases = []
  await t.exception(() => fac._releaseIp({ ip: '192.168.1.10' }), { message: 'ERR_IP_NOT_FOUND' })
})

test('_releaseIp - calls freeLeases with correct args and returns 1', async t => {
  const fac = createFacility()
  fac.leases = [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.10', subnetId: 1 }]
  let freedLeases = null
  fac.freeLeases = async (leases) => { freedLeases = leases }
  const result = await fac._releaseIp({ ip: '192.168.1.10' })
  t.is(result, 1)
  t.alike(freedLeases, [{ ip: '192.168.1.10', mac: 'aa:bb:cc:dd:ee:ff' }])
})

// ---------------------------------------------------------------------------
// _setIp
// ---------------------------------------------------------------------------

test('_setIp - throws ERR_MAC_AND_SUBNET_REQUIRED when mac is missing', async t => {
  const fac = createFacility()
  await t.exception(() => fac._setIp({ mac: null, subnet: '192.168.1.0/24' }), { message: 'ERR_MAC_AND_SUBNET_REQUIRED' })
})

test('_setIp - throws ERR_MAC_AND_SUBNET_REQUIRED when subnet is missing', async t => {
  const fac = createFacility()
  await t.exception(() => fac._setIp({ mac: 'aa:bb:cc:dd:ee:ff', subnet: null }), { message: 'ERR_MAC_AND_SUBNET_REQUIRED' })
})

test('_setIp - throws ERR_SUBNET_NOT_FOUND for unknown subnet', async t => {
  const fac = createFacility()
  fac.subnets = []
  await t.exception(() => fac._setIp({ mac: 'aa:bb:cc:dd:ee:ff', subnet: '192.168.1.0/24' }), { message: 'ERR_SUBNET_NOT_FOUND' })
})

test('_setIp - returns existing IP when lease already in target subnet', async t => {
  const fac = createFacility()
  fac.subnets = [{ id: 1, subnet: '192.168.1.0/24', pools: [] }]
  fac.leases = [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.10', subnetId: 1 }]
  fac.setLeases = async () => ({ success: [], error: [] })
  const ip = await fac._setIp({ mac: 'aa:bb:cc:dd:ee:ff', subnet: '192.168.1.0/24' })
  t.is(ip, '192.168.1.10')
})

test('_setIp - throws ERR_IN_ANOTHER_SUBNET when mac is on different subnet without forceSetIp', async t => {
  const fac = createFacility()
  fac.subnets = [
    { id: 1, subnet: '192.168.1.0/24', pools: [] },
    { id: 2, subnet: '10.0.0.0/24', pools: [] }
  ]
  fac.leases = [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.10', subnetId: 2 }]
  await t.exception(() => fac._setIp({ mac: 'aa:bb:cc:dd:ee:ff', subnet: '192.168.1.0/24' }), { message: 'ERR_IN_ANOTHER_SUBNET' })
})

test('_setIp - releases other subnet leases and assigns new IP when forceSetIp is true', async t => {
  const fac = createFacility()
  fac.subnets = [
    { id: 1, subnet: '192.168.1.0/24', pools: [{ pool: '192.168.1.10-192.168.1.20' }] },
    { id: 2, subnet: '10.0.0.0/24', pools: [] }
  ]
  fac.leases = [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.10', subnetId: 2 }]

  let releasedMac = null
  fac._releaseAllIpsForMac = async (mac) => {
    releasedMac = mac
    fac.leases = fac.leases.filter(l => l.mac.toLowerCase() !== mac.toLowerCase())
  }
  fac.getAvailableIp = async () => '192.168.1.10'
  fac.setLeases = async () => ({ success: [], error: [] })

  const ip = await fac._setIp({ mac: 'aa:bb:cc:dd:ee:ff', subnet: '192.168.1.0/24', forceSetIp: true })
  t.is(ip, '192.168.1.10')
  t.is(releasedMac, 'aa:bb:cc:dd:ee:ff')
})

test('_setIp - assigns new IP for mac with no existing lease', async t => {
  const fac = createFacility()
  fac.subnets = [{ id: 1, subnet: '192.168.1.0/24', pools: [{ pool: '192.168.1.10-192.168.1.20' }] }]
  fac.leases = []
  fac.getAvailableIp = async () => '192.168.1.10'
  fac.setLeases = async () => ({ success: [], error: [] })

  const ip = await fac._setIp({ mac: 'aa:bb:cc:dd:ee:ff', subnet: '192.168.1.0/24' })
  t.is(ip, '192.168.1.10')
})

test('_setIp - throws ERR_IP_ALLOCATION_FAILED when the lease add for a new ip fails', async t => {
  const fac = createFacility()
  fac.subnets = [{ id: 1, subnet: '192.168.1.0/24', pools: [{ pool: '192.168.1.10-192.168.1.20' }] }]
  fac.leases = []
  fac.getAvailableIp = async () => '192.168.1.10'
  fac.setLeases = async () => ({ success: [], error: [{ index: 0, res: { result: 1 } }] })

  await t.exception(() => fac._setIp({ mac: 'aa:bb:cc:dd:ee:ff', subnet: '192.168.1.0/24' }), { message: 'ERR_IP_ALLOCATION_FAILED' })
})

test('_setIp - releases other subnet leases when forceSetIp set and lease exists in target subnet', async t => {
  const fac = createFacility()
  fac.subnets = [
    { id: 1, subnet: '192.168.1.0/24', pools: [] },
    { id: 2, subnet: '10.0.0.0/24', pools: [] }
  ]
  fac.leases = [
    { mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.10', subnetId: 1 },
    { mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.5', subnetId: 2 }
  ]

  let releasedLeases = null
  fac._releaseIpsForLeases = async (leases) => { releasedLeases = leases }
  fac.setLeases = async () => ({ success: [], error: [] })

  const ip = await fac._setIp({ mac: 'aa:bb:cc:dd:ee:ff', subnet: '192.168.1.0/24', forceSetIp: true })
  t.is(ip, '192.168.1.10')
  t.alike(releasedLeases, [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.5', subnetId: 2 }])
})

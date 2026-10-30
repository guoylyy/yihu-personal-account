// 自由天数：全部只读，模拟也不写账本。口径在 lib/freedom.js
import express from 'express'
import { ok, wrap, badRequest } from '../lib/response.js'
import { freedomOverview, freedomSimulate, SimulateError } from '../lib/freedom.js'

const router = express.Router()

router.get('/', wrap(async (req, res) => ok(res, await freedomOverview())))

router.get('/simulate', wrap(async (req, res) => {
  try {
    return ok(res, await freedomSimulate(req.query))
  } catch (e) {
    if (e instanceof SimulateError) return badRequest(res, e.message)
    throw e
  }
}))

export default router

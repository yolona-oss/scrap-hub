import { sleep } from "./time"
import { mergeDefaults } from "./mergeDefaults"
import log from '@logger'

export interface RetrierOpts {
    retries: number
    wait: number
    timeout: number
}

const retrierOptsDefaults: RetrierOpts = {
    retries: 3,
    wait: 700,
    timeout: 0
}

export async function timeouted<T>(task: () => Promise<T>, timeout: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Operation timed out"))
    }, timeout)

    task()
      .then((result) => {
        clearTimeout(timer)
        resolve(result)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

export async function retrier<T>(fn: () => Promise<T>, opts: Partial<RetrierOpts> = {}): Promise<T> {
    let { retries, wait, timeout } = mergeDefaults(opts, retrierOptsDefaults)

    if (timeout <= 0) {
        log.error("retrier::Timeout must be greater than 0. Setting to 0.")
        timeout = 0
    }

    let iter = 0
    const gain = 200
    const checkFn = async () => {
        try {
            return await fn()
        } catch (e) {
            await sleep(wait + (iter * gain))
            iter++
            return null
        }
    }
    let loopFn: () => Promise<T|null>
    if (timeout > 0) {
        // timeouted
        loopFn = async () => await new Promise((res) => {
            timeouted(checkFn, timeout).then((v) => {
                if (!v) { res(null) }
                res(v)
            }).catch(() => { res(null) })
        })
    } else {
        // common
        loopFn = checkFn
    }
    for (let attempts = 0; attempts < retries; attempts++) {
        const res = await loopFn()
        if (res) { return res } // exit success
    }

    throw new Error("retrier::Unreachable action: " + fn.name)
}

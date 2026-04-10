import { appendFileSync } from 'fs'
import chalk from 'chalk'
import { ColorName } from 'chalk'
import { createDirIfNotExist } from '@core/utils/fs-tools'
import path from 'path'
import { getInitialConfig } from '@config'
import { getInvokerDetails } from '@core/utils/misc'

function logTime() {
    return new Date().toLocaleString("ru").replace(', ', ' ')
}

enum LogLevel {
    TRACE = 0,
    DEBUG = 1,
    INFO = 2,
    WARN = 3,
    ERROR = 4,
}

function logLevelToColor(level: LogLevel) {
    switch (level) {
        case LogLevel.TRACE:
            return chalk.cyan
        case LogLevel.DEBUG:
            return chalk.blue
        case LogLevel.INFO:
            return chalk.green
        case LogLevel.WARN:
            return chalk.yellow
        case LogLevel.ERROR:
            return chalk.red
        default:
            return chalk.white
    }
}

function logLevelToSymbol(level: LogLevel) {
    switch (level) {
        case LogLevel.TRACE:
            return 'TT'
        case LogLevel.DEBUG:
            return 'DD'
        case LogLevel.INFO:
            return 'II'
        case LogLevel.WARN:
            return 'WW'
        case LogLevel.ERROR:
            return 'EE'
        default:
            return '??'
    }
}

function stringToLogLevel(str: string) {
    switch (str.toLowerCase()) {
        case 'trace':
            return LogLevel.TRACE
        case 'debug':
            return LogLevel.DEBUG
        case 'info':
            return LogLevel.INFO
        case 'warn':
            return LogLevel.WARN
        case 'error':
            return LogLevel.ERROR
        default:
            log.warn(`Unknown log level: ${str}`)
            return LogLevel.TRACE
    }
    //throw new Error(`Unknown log level: ${str}`)
}

// TODO preserve multiline to output like:
// [time]:[II] => msga uga buga
//                resume buaa default   
//                fdsfas dasf asdf asdf asd f
// [time]:[II] => next log msg

export class log {
    private static instance?: log

    private static log_file: string
    private static cur_level: LogLevel = LogLevel.TRACE
    private static prefix_len: number // if log level change we need to update this, but now log level marks are same size
    private log_to_file: (...arg: any[]) => void

    private constructor() {
        log.cur_level = stringToLogLevel(getInitialConfig().log_level)
        log.prefix_len = this.prefix(LogLevel.TRACE).length - 10 // wtf?
        if (getInitialConfig().log_to_file) {
            this.log_to_file = (...arg: any[]) => {
                try {
                    appendFileSync(log.log_file, logTime() + ' - ' + arg.join(" ") + "\n")
                } catch (e) {
                    console.error(e)
                }
            }
        } else {
            this.log_to_file = () => { }
        }
    }


    static get Instance(): log {
        if (!log.instance) {
            const curDate = new Date().toLocaleDateString("ru")
            const curTime = new Date().toLocaleTimeString("ru")

            this.log_file = path.join(".", '.log', `${curDate}_${curTime}`)
            createDirIfNotExist(".log")
            log.instance = new log();
        }
        return log.instance;
    }

    private prefix(level: LogLevel) {
        //const {functionName, lineNumber} = getInvokerDetails()
        const time = logTime()
        const mark = logLevelToColor(level)(logLevelToSymbol(level))

        return `[${time}]:[${mark}] ->`
    }

    private formatMsg(...args: any[]): any[] {
        const repetTimes = process.stdout.columns < log.prefix_len ? 0 : log.prefix_len
        let ret = new Array<any>() // "any" to save object pretty print
        for (const arg of args) {
            if (typeof arg === 'string') {
                const slices = arg.split('\n')
                let first = true
                // not add \n if slices not contains \n
                for (const slice of slices) {
                    let ws = first ? "" : " ".repeat(repetTimes)
                    if (first) { first = false }
                    // TODO fix
                    ret.push(ws + slice + (slices.length === 1 && arg.endsWith('\n') ? '' : '\n'))
                }
            } else {
                ret.push(arg)
            }
        }
        // remove last \n if its string
        if (typeof ret[ret.length - 1] === 'string' && ret[ret.length - 1].endsWith('\n')) {
            ret[ret.length - 1] = ret[ret.length - 1].slice(0, -1)
        }
        return ret
    }

    private log_filter(level: LogLevel, ...arg: any[]) {
        this.log_to_file(...arg)

        if (level >= log.cur_level) {
            console.log(this.prefix(level), ...this.formatMsg(...arg))
        }
    }

    static error(...arg: any[]) { log.Instance.log_filter(LogLevel.ERROR, ...arg) }
    static warn (...arg: any[]) { log.Instance.log_filter(LogLevel.WARN,  ...arg) }
    static info (...arg: any[]) { log.Instance.log_filter(LogLevel.INFO,  ...arg) }
    static debug(...arg: any[]) { log.Instance.log_filter(LogLevel.DEBUG, ...arg) }
    static trace(...arg: any[]) { log.Instance.log_filter(LogLevel.TRACE, ...arg) }

    lineSep(symbol: string = '~', color: ColorName = 'white') {
        const cols = process.stdout.columns
        console.log(
            chalk.bold(
                chalk[color]((symbol.slice(0, 1)).repeat(cols))
            )
        )
    }
}

// createtion time set trigger
log.Instance
export default log

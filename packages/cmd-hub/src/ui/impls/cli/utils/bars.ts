import { Identificable } from '@core/types/identificable'

import { MultiProgressBars  } from 'multi-progress-bars';
import chalk from 'chalk';

const projectname = "web3-multiprofile"

export function taskBarID(obj: Identificable) {
    return "id:"+obj.id
}

export let mpb: MultiProgressBars

export class WorkerBarHelper {
    private curTask = 0
    constructor(
        private obj: Identificable,
        private tasks: Array<string>
    ) {

    }

    create() {
        mpb.addTask(taskBarID(this.obj), {
            type: "percentage",
            message: "",
            barTransformFn: (m) => chalk.blueBright(m),
            percentage: 0
        })
    }

    next(i: number) {
        this.curTask = i
        mpb.updateTask(taskBarID(this.obj), {
            message: this.tasks[this.curTask],
            percentage: this.curTask/this.tasks.length
        })
    }

    done(success: boolean, desc?: string) {
        mpb.done(taskBarID(this.obj), {
            barTransformFn: (m) => chalk[(success ? "green" : "red")](m),
            message: (success ? desc ?? "Success" : desc ?? "Failed")
        })
    }
}

export function createMainProgress(cur: number, overall: number) {
    mpb = new MultiProgressBars({
        initMessage: ' $ ' + projectname + ' ',
        anchor: 'top',
        persist: true,
        border: true,
    })

    mpb.addTask("Progress", {
        type: "percentage",
        message: cur+"/"+overall+" 0 errors",
        barTransformFn: (m) => chalk.blueBright(m)
    })
}

export function updateMainProgress(cur: number, overall: number, errors: number) {
    mpb.updateTask("Progress", {
        message: cur+"/"+overall+" "+errors+" errors"
    })
}

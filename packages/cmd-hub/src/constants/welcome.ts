import { inCenter } from "@cmd-hub/common"
import chalk from 'chalk'

const bar = (fill: string = "#") => new Array(process.stdout.columns).fill(fill).join("")
export const WELCOME_TEXT = `


${bar("#")}

${inCenter(chalk.yellow.bold("Welcome to the cmd-deploy-hub"))}

`

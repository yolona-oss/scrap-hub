import { inCenter } from "@utils/console"
import chalk from 'chalk'

const bar = (fill: string = "#") => new Array(process.stdout.columns).fill(fill).join("")
export const WELCOME_TEXT = `


${bar("#")}

${inCenter(chalk.yellow.bold("Welcome to the cmd-deploy-hub"))}

`

import * as fs from 'fs'
import { min, pattern, Infer, assert, object, number, string, boolean } from 'superstruct'
import { readFileSync } from 'fs'
import { main_config_path } from './constants/path'
import Path from 'path'
import AsyncLock from 'async-lock';

import log from './application/logger';

import * as readline from 'readline';

const lock = new AsyncLock();

function writeConfig(newConfig: Infer<typeof ConfigSign>) {
    fs.writeFileSync(
        main_config_path,
        JSON.stringify(newConfig, null, " ".repeat(4))
    )
}

function parseConfig() {
    let config;
    try {
        config = JSON.parse(readFileSync(main_config_path).toString());
    } catch(e) {
        throw new Error("Config parse error: " + e);
    }

    assert(config, ConfigSign);

    return config
}

const ConfigSign = object({
    show_logo: boolean(),
    show_commands: boolean(),
    dev_mode: boolean(),

    bot: object({
        token: pattern(string(), /^[0-9]{8,10}:[a-zA-Z0-9_-]{35}$/),
        admin_id: number(),
        name: string(),
    }),

    server: object({
        ngrok: object({
            authtoken: string()
        }),

        database: object({
            mongoose: object({
                connectionUri: string(),
                connectionOptions: object(),
            }),
            path: string(),
        }),

        fileStorage: object({
            path: string(),
        }),

        port: min(number(), 1000),
        uri: string(),
    }),

    log_level: string(),
    log_to_file: boolean()
})

const EMPTY_CONFIG: ConfigType = {
    show_logo: true,
    show_commands: true,
    dev_mode: false,

    bot: {
        token: "",
        admin_id: 0,
        name: "Barebuh"
    },

    server: {
        ngrok: {
            authtoken: ""
        },

        database: {
            mongoose: {
                connectionUri: "mongodb://localhost:27017/",
                connectionOptions: {
                    dbName: "cmd-deploy-hub-v1"
                }
            },
            path: "./storage",
        },

        fileStorage: {
            path: Path.join("storage", "files"),
        },

        port: 7999,

        uri: 'http://localhost:7999',
    },

    log_level: "trace",
    log_to_file: false
}

export async function createConfigIfNotExists() {
    if (!fs.existsSync(main_config_path)) {
        log.info("Creating config with default params")

        function askPrompt<T extends string|number = string>(
            question: string,
            validator: (v: string) => boolean = () => true,
            defaultValue: T
        ): Promise<T> {
            return new Promise((resolve) => {
                rl.question(question, (answer) => {
                    const isAnswerEmpty = answer.trim().length === 0;
                    const isAnswerValid = validator(answer);
                    const isDefaultValid = defaultValue ? validator(String(defaultValue)) : true;

                    if (isAnswerEmpty || !isAnswerValid) {
                        if (defaultValue && (isDefaultValid || defaultValue === "")) {
                            resolve(defaultValue);
                        } else {
                            console.log("Invalid input. Please try again.");
                            resolve(askPrompt(question, validator, defaultValue));
                        }
                    } else {
                        let ret
                        if (typeof defaultValue === "string") {
                            ret = answer
                        } else {
                            ret = Number(answer)
                        }

                        resolve(ret as T);
                    }
                });
            });
        }

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        const skip = await askPrompt("Skip manual config creationg and set to defaults? (y/N) ", (v) => Boolean(v.match(/^[yYnN]{1}$/)), "n");

        if (skip.toLowerCase() === "y") {
            console.log("Creating default empty config")
            writeConfig(EMPTY_CONFIG)
            rl.close();
        }

        console.log("Creating manual config")

        const path_validator = (v: string) => Boolean(v.match(/^(?:[A-Za-z]:)?(?:\/{0,2}[^<>"\\|:;*?*]+)+$/))

        const bot_token = await askPrompt("Bot api token: ", (v) => Boolean(v.match(/^[0-9]{8,10}:[a-zA-Z0-9_-]{35}$/)), "null");
        const admin_id = await askPrompt<number>("Admin id: ", (v) => Boolean(v.match(/^[0-9]{9}$/)), -1);
        const bot_name = await askPrompt("Bot name: ", ()=>true, "cmd_deploy_hub_bot");
        const ngrok_token = await askPrompt("Ngrok authtoken: ", (v) => Boolean(v.match(/^[0-9A-Za-z]{48}$/)), "");
        const mongodb_uri = await askPrompt("Mongodb uri: ", (v) => Boolean(v.match(/^mongodb:\/\/.+:[0-9]+/)), "mongodb://localhost:27017");
        const mongodb_name = await askPrompt("Mongodb name: ", ()=>true, "cmd-deploy-hub-v1");
        const storage_path = await askPrompt("Storage path: ", path_validator, Path.join("app-data", "cmd-deploy-hub"));
        const public_storage_path = await askPrompt("Public storage path: ", path_validator, Path.join(storage_path, "static"));
        const server_uri = await askPrompt("Server uri: ", (v) => Boolean(v.match(/^http(s)?:\/\/.+:[0-9]+/)), "http://localhost");
        const server_port = await askPrompt<number>("Port: ", (v) => Boolean(v.match(/^[0-9]{4,5}$/)), 7999);
        const log_level = await askPrompt("Log level: ", (v) => Boolean(v.match(/^(trace|debug|info|warn|error)$/)), "trace"); // trace, debug, info, warn, error

        const user_config = {
            show_logo: true,
            show_commands: true,
            dev_mode: false,

            bot: {
                token: bot_token,
                admin_id,
                name: bot_name
            },

            server: {
                ngrok: {
                    authtoken: ngrok_token
                },

                database: {
                    mongoose: {
                        connectionUri: mongodb_uri,
                        connectionOptions: {
                            dbName: mongodb_name
                        }
                    },
                    path: storage_path,
                },

                fileStorage: {
                    path: public_storage_path,
                },

                port: server_port,

                uri: server_uri,
            },

            log_level,
            log_to_file: false,
        }

        writeConfig(user_config)
        rl.close()
    }
}

export { ConfigSign }
export type ConfigType = Infer<typeof ConfigSign>;

async function loadConfig(): Promise<ConfigType> {
    return await lock.acquire('config', async () => {
        return parseConfig();
    });
}

export function updateConfig(newConfig: Partial<ConfigType>): Promise<void> {
    return lock.acquire('config', async () => {
        let updatingConfig = loadConfig();
        updatingConfig = { ...updatingConfig, ...newConfig };
        assert(updatingConfig, ConfigSign);
        writeConfig(updatingConfig);
    })
}

let configPromise = loadConfig();

export async function getConfig(): Promise<ConfigType> {
    return await configPromise;
}

export function getInitialConfig() {
    return parseConfig();
}

// Register core config modules
import { ConfigRegistry } from './config-registry'

ConfigRegistry.register({
    name: 'bot',
    scope: 'bootstrap',
    defaults: { token: '', admin_id: 0, name: 'CmdHub' },
    sensitive: ['token']
})

ConfigRegistry.register({
    name: 'server',
    scope: 'bootstrap',
    defaults: {
        ngrok: { authtoken: '' },
        database: { mongoose: { connectionUri: 'mongodb://localhost:27017/', connectionOptions: { dbName: 'cmd-hub' } }, path: './storage' },
        fileStorage: { path: 'storage/files' },
        port: 7999,
        uri: 'http://localhost:7999'
    },
    sensitive: ['authtoken']
})

ConfigRegistry.register({
    name: 'ui',
    scope: 'bootstrap',
    defaults: { show_logo: true, show_commands: true, dev_mode: false },
})

ConfigRegistry.register({
    name: 'logging',
    scope: 'bootstrap',
    defaults: { log_level: 'trace', log_to_file: false },
})

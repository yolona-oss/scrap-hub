export interface IRunnable {
    isRunning(): boolean

    /***
    * @description Run the service
    */
    run(): Promise<void>
    /***
    * @description Terminate the service
    */
    terminate(): Promise<void>
}

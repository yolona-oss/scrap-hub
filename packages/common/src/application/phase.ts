export enum Phase {
    Infrastructure = 10,
    Storage = 20,
    Transport = 30,
    /** Sorts strictly between Transport and Services. Use for hooks that must
     *  observe the post-Transport capability set before any Services-phase
     *  middleware (e.g. HubClientMiddleware) reads it. */
    BeforeServices = 39,
    Services = 40,
    UI = 50,
}

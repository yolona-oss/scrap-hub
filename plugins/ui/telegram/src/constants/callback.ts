export const auth_cb_prefix = {
    directJoinRequestToAdmin: 'approve_request',
    approveJoinRequest:       'approve_manager',
    rejectJoinRequest:        'reject_manager',
};

export const dashboard_cb_prefix = {
    launch: 'dashboard_launch',
    back: 'dashboard_back',
    quit: 'dashboard_quit',
};

export const decodeCbData = (() => {
    function joinReqRedirection(data: string): string {
        return data.slice(auth_cb_prefix.directJoinRequestToAdmin.length)
    }

    function joinReqApprove(data: string): string {
        return data.slice(auth_cb_prefix.approveJoinRequest.length)
    }

    function joinReqReject(data: string): string {
        return data.slice(auth_cb_prefix.rejectJoinRequest.length)
    }

    return {
        auth: {
            joinReqRedirection,
            joinReqApprove,
            joinReqReject
        }
    }
})()

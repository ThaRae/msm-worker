/* MSM companion: mints a Steam auth session ticket for app 1419170
 * using the game's own steam_api.dll. Prints "TICKET:<hex>" on success.
 * Must run in the same bottle as Steam (game itself is never launched).
 */
#include <windows.h>
#include <stdio.h>
#include <string.h>

typedef int (*pfn_IsSteamRunning)();
typedef int (*pfn_InitSafe)();
typedef int (*pfn_GetHSteamUser)();
typedef void* (*pfn_FindOrCreateInterface)(int hUser, const char* ver);
typedef unsigned int (*pfn_GetAuthSessionTicket)(void* pUser, void* pBuf, int cbBuf, unsigned int* pcbTicket);
typedef void (*pfn_RunCallbacks)();
typedef void (*pfn_Shutdown)();

static pfn_IsSteamRunning IsSteamRunning;
static pfn_InitSafe InitSafe;
static pfn_GetHSteamUser GetHSteamUser;
static pfn_FindOrCreateInterface FindOrCreateInterface;
static pfn_GetAuthSessionTicket GetAuthSessionTicket;
static pfn_RunCallbacks RunCallbacks;
static pfn_Shutdown Shutdown;

/* GetAuthSessionTicketResponse_t */
#pragma pack(push, 1)
typedef struct {
    unsigned int m_hAuthTicket;   /* 0 */
    int m_eResult;               /* 4 - 1 = OK */
} AuthTicketResponse_t;
#pragma pack(pop)

/* Callback registration without steam_api.lib: use SteamAPI_RegisterCallback.
 * Easier: poll with SteamAPI_RunCallbacks + a callback we can't intercept without the interface...
 * Instead we use flat API: SteamAPI_ISteamUser_GetAuthSessionTicket is async; response is
 * delivered as a callback. To receive it without headers we use the "callback capture" trick:
 * SteamAPI_RegisterCallback is exported with a pCallback object (vtable slot 1 = Run with param).
 */
typedef void (*pfn_RegisterCallback)(void* pCallback, int iCallback);

#pragma pack(push, 1)
typedef struct {
    void** vtbl;
    unsigned char vtbl_storage[8];
    volatile int done;
    int eResult;
} SimpleCb;
#pragma pack(pop)

static void __thiscall Cb_Run(SimpleCb* self, void* param) {
    AuthTicketResponse_t* r = (AuthTicketResponse_t*)param;
    self->eResult = r->m_eResult;
    self->done = 1;
}

int main(int argc, char** argv) {
    HMODULE h = LoadLibraryA("steam_api.dll");
    if (!h) { fprintf(stderr, "ERR: cannot load steam_api.dll (put next to exe)\n"); return 1; }
    IsSteamRunning = (pfn_IsSteamRunning)GetProcAddress(h, "SteamAPI_IsSteamRunning");
    InitSafe = (pfn_InitSafe)GetProcAddress(h, "SteamAPI_InitSafe");
    GetHSteamUser = (pfn_GetHSteamUser)GetProcAddress(h, "SteamAPI_GetHSteamUser");
    FindOrCreateInterface = (pfn_FindOrCreateInterface)GetProcAddress(h, "SteamInternal_FindOrCreateUserInterface");
    GetAuthSessionTicket = (pfn_GetAuthSessionTicket)GetProcAddress(h, "SteamAPI_ISteamUser_GetAuthSessionTicket");
    RunCallbacks = (pfn_RunCallbacks)GetProcAddress(h, "SteamAPI_RunCallbacks");
    Shutdown = (pfn_Shutdown)GetProcAddress(h, "SteamAPI_Shutdown");
    pfn_RegisterCallback RegisterCallback = (pfn_RegisterCallback)GetProcAddress(h, "SteamAPI_RegisterCallback");
    if (!IsSteamRunning || !InitSafe || !GetHSteamUser || !FindOrCreateInterface || !GetAuthSessionTicket || !RunCallbacks || !Shutdown || !RegisterCallback) {
        fprintf(stderr, "ERR: missing exports\n"); return 1;
    }
    if (!IsSteamRunning()) { fprintf(stderr, "ERR: Steam is not running\n"); return 2; }
    if (!InitSafe()) { fprintf(stderr, "ERR: SteamAPI_Init failed\n"); return 3; }

    int hUser = GetHSteamUser();
    void* pUser = FindOrCreateInterface(hUser, "SteamUser023");
    if (!pUser) { fprintf(stderr, "ERR: no ISteamUser\n"); return 4; }

    unsigned char ticket[4096];
    unsigned int ticketLen = 0;

    SimpleCb cb;
    static void* myvtbl[3];
    myvtbl[1] = (void*)Cb_Run;
    cb.vtbl = myvtbl;
    cb.done = 0;
    cb.eResult = -1;
    RegisterCallback(&cb, 163); /* GetAuthSessionTicketResponse_t = 163 */

    unsigned int hTicket = GetAuthSessionTicket(pUser, ticket, sizeof(ticket), &ticketLen);
    fprintf(stderr, "requested ticket handle=%u initial_len=%u\n", hTicket, ticketLen);

    for (int i = 0; i < 300 && !cb.done; i++) {
        RunCallbacks();
        Sleep(100);
    }
    if (!cb.done) { fprintf(stderr, "ERR: no ticket response\n"); Shutdown(); return 5; }
    if (cb.eResult != 1) { fprintf(stderr, "ERR: ticket result=%d\n", cb.eResult); Shutdown(); return 6; }

    printf("TICKET:");
    for (unsigned int i = 0; i < ticketLen; i++) printf("%02x", ticket[i]);
    printf("\nTICKETLEN:%u\n", ticketLen);
    Shutdown();
    return 0;
}

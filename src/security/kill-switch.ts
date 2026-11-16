export type KillSwitchState = {
  globalDisabled: boolean;
  disabledClientIds: string[];
  pilotClientIds: string[];
};

const DEFAULT_STATE: KillSwitchState = {
  globalDisabled: false,
  disabledClientIds: [],
  pilotClientIds: [],
};

export async function loadKillSwitch(kv: KVNamespace): Promise<KillSwitchState> {
  const raw = await kv.get<KillSwitchState>("ops:kill_switch", "json");
  return raw ?? DEFAULT_STATE;
}

export async function saveKillSwitch(kv: KVNamespace, state: KillSwitchState): Promise<void> {
  await kv.put("ops:kill_switch", JSON.stringify(state));
}

export function evaluateAccess(state: KillSwitchState, clientId: string): { allowed: boolean; reason?: string } {
  if (state.globalDisabled) return { allowed: false, reason: "kill_switch_global" };
  if (state.disabledClientIds.includes(clientId)) return { allowed: false, reason: "kill_switch_client" };
  if (state.pilotClientIds.length > 0 && !state.pilotClientIds.includes(clientId)) {
    return { allowed: false, reason: "pilot_allowlist" };
  }
  return { allowed: true };
}
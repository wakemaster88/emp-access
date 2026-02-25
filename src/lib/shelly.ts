export interface ShellyConfig {
  ipAddress?: string | null;
  shellyId?: string | null;
  shellyAuthKey?: string | null;
  cloudServer?: string;
}

export interface ShellyStatus {
  online: boolean;
  relayOn: boolean;
  power?: number;
  temperature?: number;
}

export async function shellyLocalControl(
  ip: string,
  action: "on" | "off" | "toggle",
  timer?: number
): Promise<boolean> {
  try {
    const params = new URLSearchParams({ turn: action });
    if (timer) params.set("timer", String(timer));
    const res = await fetch(
      `http://${ip}/relay/0?${params.toString()}`,
      { signal: AbortSignal.timeout(5000) }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function shellyCloudControl(
  config: ShellyConfig,
  action: "on" | "off" | "toggle"
): Promise<boolean> {
  if (!config.shellyId || !config.shellyAuthKey) return false;

  const server = config.cloudServer ?? "shelly-46-eu.shelly.cloud";
  try {
    const res = await fetch(
      `https://${server}/device/relay/control`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          id: config.shellyId,
          auth_key: config.shellyAuthKey,
          channel: "0",
          turn: action,
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    const data = await res.json();
    return data.isok === true;
  } catch {
    return false;
  }
}

export async function shellyLocalStatus(ip: string): Promise<ShellyStatus | null> {
  try {
    const res = await fetch(`http://${ip}/status`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      online: true,
      relayOn: data.relays?.[0]?.ison ?? false,
      power: data.meters?.[0]?.power,
      temperature: data.temperature,
    };
  } catch {
    return { online: false, relayOn: false };
  }
}

export async function shellyCloudStatus(
  config: ShellyConfig
): Promise<ShellyStatus | null> {
  if (!config.shellyId || !config.shellyAuthKey) return null;

  const server = config.cloudServer ?? "shelly-46-eu.shelly.cloud";
  try {
    const res = await fetch(`https://${server}/device/status`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        id: config.shellyId,
        auth_key: config.shellyAuthKey,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!data.isok) return { online: false, relayOn: false };
    return {
      online: data.data?.online ?? false,
      relayOn: data.data?.device_status?.relays?.[0]?.ison ?? false,
    };
  } catch {
    return { online: false, relayOn: false };
  }
}

export async function controlShelly(
  config: ShellyConfig,
  action: "on" | "off" | "toggle",
  timer?: number
): Promise<boolean> {
  if (config.ipAddress) {
    return shellyLocalControl(config.ipAddress, action, timer);
  }
  return shellyCloudControl(config, action);
}

export async function getStatus(config: ShellyConfig): Promise<ShellyStatus | null> {
  if (config.ipAddress) {
    return shellyLocalStatus(config.ipAddress);
  }
  return shellyCloudStatus(config);
}

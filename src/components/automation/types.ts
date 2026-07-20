import type {
  ShellyGroup,
  ShellyGroupMember,
  ShellyAutomation,
  ShellyAutomationRun,
  ShellyAction,
  AutomationTrigger,
  DeviceCategory,
} from "@prisma/client";

export interface ShellyDeviceOption {
  id: number;
  name: string;
  category: DeviceCategory | null;
}

export interface AccountInfo {
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
}

export type GroupMemberWithDevice = ShellyGroupMember & {
  device: { id: number; name: string; category: DeviceCategory | null };
};

export type GroupWithMembers = ShellyGroup & {
  members: GroupMemberWithDevice[];
  _count: { automations: number };
};

export type AutomationWithGroup = ShellyAutomation & {
  group: { id: number; name: string };
  camera: { id: number; name: string } | null;
};

export interface CameraOption {
  id: number;
  name: string;
}

export type AutomationRunRow = ShellyAutomationRun & {
  automation: { id: number; name: string } | null;
};

export type { ShellyAction, AutomationTrigger };

"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Server, Network, Cable, MonitorSmartphone } from "lucide-react";
import { NetworkDevicesTab } from "@/components/network/network-devices-tab";
import { VlansTab } from "@/components/network/vlans-tab";
import { OutletsTab } from "@/components/network/outlets-tab";
import { ClientsTab } from "@/components/network/clients-tab";
import type {
  NetworkDeviceRow,
  VlanRow,
  OutletRow,
  ClientRow,
  IotDeviceOption,
  PortOption,
} from "@/components/network/network-types";

interface NetworkTabsProps {
  networkDevices: NetworkDeviceRow[];
  vlans: VlanRow[];
  outlets: OutletRow[];
  clients: ClientRow[];
  iotDevices: IotDeviceOption[];
  allPorts: PortOption[];
}

export function NetworkTabs({
  networkDevices,
  vlans,
  outlets,
  clients,
  iotDevices,
  allPorts,
}: NetworkTabsProps) {
  return (
    <Tabs defaultValue="devices">
      <TabsList className="w-full sm:w-auto overflow-x-auto">
        <TabsTrigger value="devices" className="gap-1.5">
          <Server className="h-4 w-4" />
          <span className="hidden sm:inline">Switches &amp; Router</span>
          <span className="sm:hidden">Hardware</span>
        </TabsTrigger>
        <TabsTrigger value="vlans" className="gap-1.5">
          <Network className="h-4 w-4" />
          VLANs
        </TabsTrigger>
        <TabsTrigger value="outlets" className="gap-1.5">
          <Cable className="h-4 w-4" />
          Anschlüsse
        </TabsTrigger>
        <TabsTrigger value="clients" className="gap-1.5">
          <MonitorSmartphone className="h-4 w-4" />
          Geräte
        </TabsTrigger>
      </TabsList>

      <TabsContent value="devices">
        <NetworkDevicesTab devices={networkDevices} />
      </TabsContent>
      <TabsContent value="vlans">
        <VlansTab vlans={vlans} />
      </TabsContent>
      <TabsContent value="outlets">
        <OutletsTab outlets={outlets} />
      </TabsContent>
      <TabsContent value="clients">
        <ClientsTab
          clients={clients}
          iotDevices={iotDevices}
          vlans={vlans}
          ports={allPorts}
        />
      </TabsContent>
    </Tabs>
  );
}

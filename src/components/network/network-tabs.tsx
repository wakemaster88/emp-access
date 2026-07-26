"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Server, Network, Cable, MonitorSmartphone, Radar } from "lucide-react";
import { DiscoveredTab, type DiscoveredRow } from "@/components/network/discovered-tab";
import { NetworkDevicesTab } from "@/components/network/network-devices-tab";
import { VlansTab } from "@/components/network/vlans-tab";
import { OutletsTab } from "@/components/network/outlets-tab";
import { ClientsTab } from "@/components/network/clients-tab";
import type {
  NetworkDeviceRow,
  VlanRow,
  AreaRow,
  OutletRow,
  ClientRow,
  IotDeviceOption,
  PortOption,
} from "@/components/network/network-types";

interface NetworkTabsProps {
  networkDevices: NetworkDeviceRow[];
  vlans: VlanRow[];
  areas: AreaRow[];
  outlets: OutletRow[];
  clients: ClientRow[];
  iotDevices: IotDeviceOption[];
  allPorts: PortOption[];
  discoveredDevices: DiscoveredRow[];
}

export function NetworkTabs({
  networkDevices,
  vlans,
  areas,
  outlets,
  clients,
  iotDevices,
  allPorts,
  discoveredDevices,
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
        <TabsTrigger value="discovered" className="gap-1.5">
          <Radar className="h-4 w-4" />
          <span className="hidden sm:inline">Entdeckt</span>
          <span className="sm:hidden">Scan</span>
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
          areas={areas}
          ports={allPorts}
        />
      </TabsContent>
      <TabsContent value="discovered">
        <DiscoveredTab devices={discoveredDevices} vlans={vlans} areas={areas} />
      </TabsContent>
    </Tabs>
  );
}

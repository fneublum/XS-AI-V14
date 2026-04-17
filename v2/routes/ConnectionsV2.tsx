// Phase 3B — v2 Connections.
//
// Inspection-only view of integration status. Real OAuth flows live in
// their v1 counterparts; Phase 3C will port the enable/disable actions.

import React from 'react';
import { Card, CardHeader, CardTitle, Badge } from '../primitives';
import { useToast } from '../primitives/Toast';

interface Integration {
  id: string;
  name: string;
  description: string;
  status: 'connected' | 'disconnected' | 'pending';
  scope?: string;
}

const integrations: Integration[] = [
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'Primary data store. Auth-issue + gemini-proxy Edge Functions deployed.',
    status: 'connected',
    scope: 'Project qfskvevighylzzmyiwre',
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks Online',
    description: 'Invoice + payment sync. OAuth via qb-auth edge function.',
    status: 'pending',
    scope: 'Requires user OAuth',
  },
  {
    id: 'microsoft',
    name: 'Microsoft 365',
    description: 'Outlook, SharePoint, Graph for the AI Email Assistant.',
    status: 'pending',
    scope: 'MSAL configured',
  },
  {
    id: 'google',
    name: 'Google',
    description: 'Gmail + Gemini. All Gemini calls now route through server-side gemini-proxy.',
    status: 'connected',
    scope: 'Gemini proxied',
  },
  {
    id: 'twilio',
    name: 'Twilio',
    description: 'SMS + voice via twilio-send and twilio-webhook edge functions.',
    status: 'connected',
    scope: 'Signed webhooks',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Cloud API',
    description: 'Meta Cloud API for inbound and outbound messages.',
    status: 'connected',
    scope: 'whatsapp-send deployed',
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    description: 'Text-to-speech for voice agents. API key in Edge Function secrets.',
    status: 'connected',
    scope: 'Secret set',
  },
  {
    id: 'hall',
    name: 'HALL Memory',
    description: 'External long-term memory service (gen-lang-client-0755290444).',
    status: 'connected',
    scope: 'Cloud Run instance',
  },
  {
    id: 'shipsgo',
    name: 'ShipsGo',
    description: 'Container tracking across ocean carriers.',
    status: 'disconnected',
    scope: 'No key set',
  },
];

const statusTone: Record<Integration['status'], 'success' | 'warning' | 'neutral'> = {
  connected:    'success',
  pending:      'warning',
  disconnected: 'neutral',
};

const ConnectionsV2: React.FC = () => {
  const toast = useToast();

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">Connections</h1>
        <p className="text-[13px] text-slate-500 mt-0.5">
          External services this workspace talks to. Secrets live in Supabase Edge Function secrets — never in the browser bundle.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <span className="text-[11px] text-slate-500 font-mono tabular-nums">
            {integrations.filter(i => i.status === 'connected').length}/{integrations.length} connected
          </span>
        </CardHeader>
        <ul className="divide-y divide-[#1f1f1f]">
          {integrations.map(i => (
            <li
              key={i.id}
              className="px-4 py-3 flex items-start gap-3 hover:bg-[#111111] cursor-pointer"
              onClick={() => toast.push({
                kind: 'info',
                title: i.name,
                description: i.status === 'connected'
                  ? 'Manage flow ships with Phase 3C.'
                  : i.status === 'pending'
                    ? 'Click Connect to launch OAuth (Phase 3C).'
                    : 'Add your API key in Supabase Edge Function secrets.',
              })}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-slate-100">{i.name}</span>
                  <Badge variant={statusTone[i.status]} dot>{i.status}</Badge>
                </div>
                <p className="text-[12px] text-slate-500 mt-0.5">{i.description}</p>
                {i.scope && (
                  <p className="text-[11px] text-slate-600 font-mono tabular-nums mt-1">{i.scope}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
};

export default ConnectionsV2;

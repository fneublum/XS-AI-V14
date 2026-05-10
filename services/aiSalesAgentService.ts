// AI Sales Agent service.
//
// Orchestrates proposal drafting, PDF rendering, and multi-channel
// delivery (email + WhatsApp). Persists proposals to Supabase and
// surfaces a review queue so drafts can be approved or dismissed
// before they go out — mirrors the Email Agent's draft-approve pattern.

import { getSupabaseClient } from './supabase';
import { sendEmail } from './emailService';
import { invokeEdgeFunction } from './edgeAuth';
import { generateContextualEmail } from './geminiService';
import type {
  AiSalesProposal,
  AiAgentIdentity,
  Prospect,
  Customer,
  User,
  SalesProposalAudience,
  SalesProposalChannel,
  SalesProposalMode,
  SalesProposalStatus,
  AiSalesProposalLineItem,
} from '../types';

const SYSTEM_WHATSAPP_SENDER = '+19302007070';

// ── Identity seed ─────────────────────────────────────────────

// Built-in fallback identities. Ensures a working default even before
// anyone seeds `ai_agent_identities` in the DB. For now only EC4 has a
// dedicated sales mailbox — other companies reuse the active-user
// session until their mailbox is provisioned.
const BUILT_IN_IDENTITIES: Record<string, AiAgentIdentity> = {
  EC4: {
    id: 'agent-sales-ec4',
    companyId: 'EC4',
    role: 'sales',
    displayName: 'EC4 Sales',
    emailAddress: 'sales@ec4.enterprises',
    whatsappSender: SYSTEM_WHATSAPP_SENDER,
    signature: 'EC4 Enterprises — Trading with care.',
    createdAt: '1970-01-01T00:00:00.000Z',
  },
};

export async function resolveAgentIdentity(companyId: string): Promise<AiAgentIdentity> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('ai_agent_identities')
    .select('*')
    .eq('"companyId"', companyId)
    .eq('role', 'sales')
    .limit(1)
    .maybeSingle();
  if (data) return data as AiAgentIdentity;
  return (
    BUILT_IN_IDENTITIES[companyId] ?? {
      id: `agent-sales-${companyId}`,
      companyId,
      role: 'sales',
      displayName: 'Sales Agent',
      emailAddress: '',
      whatsappSender: SYSTEM_WHATSAPP_SENDER,
      signature: null,
      createdAt: '1970-01-01T00:00:00.000Z',
    }
  );
}

// ── Target resolution ─────────────────────────────────────────

export interface ProposalTarget {
  audience: SalesProposalAudience;
  customerId?: string | null;
  prospectId?: string | null;
  salesRepId?: string | null;
  recipientName: string;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
}

export function targetFromCustomer(c: Customer): ProposalTarget {
  return {
    audience: 'customer',
    customerId: c.id,
    recipientName: c.contactPerson || c.name,
    recipientEmail: c.email ?? null,
    recipientPhone: c.phone ?? null,
  };
}

export function targetFromProspect(p: Prospect): ProposalTarget {
  return {
    audience: 'prospect',
    prospectId: p.id,
    recipientName: p.name,
    // Prospects are WhatsApp-only per product spec — email disabled.
    recipientEmail: null,
    recipientPhone: p.phone ?? null,
  };
}

export function targetFromSalesRep(u: User): ProposalTarget {
  return {
    audience: 'sales_rep',
    salesRepId: u.id,
    recipientName: u.name,
    recipientEmail: u.email ?? null,
    recipientPhone: u.phone ?? null,
  };
}

// ── Drafting ──────────────────────────────────────────────────

export interface DraftProposalInput {
  target: ProposalTarget;
  intent: string;
  channel: SalesProposalChannel;
  mode: SalesProposalMode;
  companyId: string;
  createdBy?: string;
  items?: AiSalesProposalLineItem[];
  totalAmount?: number;
  currency?: string;
  keyPoints?: string[];
  tone?: string;
}

/** Ask the LLM to draft the proposal body + subject. Returns a draft
 *  row persisted to `ai_sales_proposals`. Status is `pending_approval`
 *  when mode is `review`, `approved` when mode is `auto` (caller then
 *  invokes `sendProposal`). */
export async function draftProposal(input: DraftProposalInput): Promise<AiSalesProposal> {
  const {
    target,
    intent,
    channel,
    mode,
    companyId,
    createdBy,
    items,
    totalAmount,
    currency,
    keyPoints,
    tone,
  } = input;

  // Prospects can only receive WhatsApp per product spec.
  const resolvedChannel: SalesProposalChannel =
    target.audience === 'prospect' && channel === 'email' ? 'whatsapp' : channel;

  const identity = await resolveAgentIdentity(companyId);
  const pointsForLlm = keyPoints && keyPoints.length > 0 ? keyPoints : [intent];
  const llmOutput = await generateContextualEmail(
    target.recipientName,
    intent,
    pointsForLlm,
    tone ?? 'professional, warm, concise',
  );

  const subject = llmOutput?.subject ?? intent.slice(0, 80);
  const body = llmOutput?.body ?? `Hi ${target.recipientName},\n\n${intent}\n\nBest regards,\n${identity.displayName}`;

  // WhatsApp messages stay short — strip greeting/signoff and collapse.
  const whatsappPreview = buildWhatsAppPreview(body, target.recipientName);

  const id = `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const row: AiSalesProposal = {
    id,
    companyId,
    audience: target.audience,
    customerId: target.customerId ?? null,
    prospectId: target.prospectId ?? null,
    salesRepId: target.salesRepId ?? null,
    recipientName: target.recipientName,
    recipientEmail: target.recipientEmail ?? null,
    recipientPhone: target.recipientPhone ?? null,
    channel: resolvedChannel,
    status: mode === 'auto' ? 'approved' : 'pending_approval',
    mode,
    intent,
    subject,
    body,
    whatsappPreview,
    pdfUrl: null,
    reasoning: llmOutput ? 'Drafted by AI from intent + key points.' : 'Fallback template (LLM unavailable).',
    items: items ?? null,
    totalAmount: totalAmount ?? null,
    currency: currency ?? 'USD',
    agentIdentityId: identity.id,
    sentAt: null,
    errorMessage: null,
    createdBy: createdBy ?? null,
    createdAt: new Date().toISOString(),
  };

  const supabase = getSupabaseClient();
  const { error } = await supabase.from('ai_sales_proposals').insert(row);
  if (error) throw new Error(`Failed to save proposal draft: ${error.message}`);
  return row;
}

function buildWhatsAppPreview(body: string, recipient: string): string {
  const firstName = recipient.split(/\s+/)[0] || 'there';
  // Drop any existing greeting/signoff lines from the LLM output and keep
  // the core 2-3 sentences. WhatsApp messages read best this way.
  const stripped = body
    .replace(/^hi[^.,\n]*[.,\n]\s*/i, '')
    .replace(/(best regards|regards|thanks|thank you|sincerely)[\s\S]*$/i, '')
    .trim();
  const trimmed = stripped.length > 500 ? `${stripped.slice(0, 500).trim()}…` : stripped;
  return `Hi ${firstName}, ${trimmed}`;
}

// ── Queue ops ─────────────────────────────────────────────────

export async function listProposals(filter: { companyId: string; status?: SalesProposalStatus }): Promise<AiSalesProposal[]> {
  const supabase = getSupabaseClient();
  let q = supabase.from('ai_sales_proposals').select('*').order('createdAt', { ascending: false });
  if (filter.companyId !== 'ALL') q = q.eq('"companyId"', filter.companyId);
  if (filter.status) q = q.eq('status', filter.status);
  const { data, error } = await q;
  if (error) throw new Error(`Failed to list proposals: ${error.message}`);
  return (data ?? []) as AiSalesProposal[];
}

export async function approveProposal(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('ai_sales_proposals')
    .update({ status: 'approved' })
    .eq('id', id);
  if (error) throw new Error(`Failed to approve proposal: ${error.message}`);
}

export async function dismissProposal(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('ai_sales_proposals')
    .update({ status: 'dismissed' })
    .eq('id', id);
  if (error) throw new Error(`Failed to dismiss proposal: ${error.message}`);
}

export async function updateProposalDraft(
  id: string,
  patch: Partial<Pick<AiSalesProposal, 'subject' | 'body' | 'whatsappPreview'>>,
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('ai_sales_proposals').update(patch).eq('id', id);
  if (error) throw new Error(`Failed to update proposal: ${error.message}`);
}

// ── Delivery ──────────────────────────────────────────────────

export interface SendResult {
  emailSent: boolean;
  whatsappSent: boolean;
  errors: string[];
}

export async function sendProposal(
  proposal: AiSalesProposal,
  opts?: { pdfAttachment?: { name: string; base64: string } },
): Promise<SendResult> {
  const supabase = getSupabaseClient();
  await supabase.from('ai_sales_proposals').update({ status: 'sending' }).eq('id', proposal.id);

  const errors: string[] = [];
  let emailSent = false;
  let whatsappSent = false;

  const wantsEmail = proposal.channel === 'email' || proposal.channel === 'both';
  const wantsWhatsApp = proposal.channel === 'whatsapp' || proposal.channel === 'both';

  if (wantsEmail) {
    if (!proposal.recipientEmail) {
      errors.push('email channel requested but recipient has no email');
    } else {
      try {
        const identity = await resolveAgentIdentity(proposal.companyId);
        const htmlBody = proposal.body
          ? proposal.body.split('\n').map(l => `<p style="margin:0 0 8px 0;">${escapeHtml(l)}</p>`).join('')
          : '';
        await sendEmail({
          to: [proposal.recipientEmail],
          subject: proposal.subject ?? 'Proposal',
          htmlBody,
          from: identity.emailAddress || undefined,
          attachments: opts?.pdfAttachment
            ? [{
                name: opts.pdfAttachment.name,
                contentBytes: opts.pdfAttachment.base64,
                contentType: 'application/pdf',
              }]
            : undefined,
        });
        emailSent = true;
      } catch (err: any) {
        errors.push(`email: ${err?.message ?? String(err)}`);
      }
    }
  }

  if (wantsWhatsApp) {
    if (!proposal.recipientPhone) {
      errors.push('whatsapp channel requested but recipient has no phone');
    } else {
      try {
        await invokeEdgeFunction('whatsapp-send', {
          method: 'POST',
          body: {
            to: proposal.recipientPhone,
            text: proposal.whatsappPreview ?? proposal.body ?? '',
          },
        });
        whatsappSent = true;
      } catch (err: any) {
        errors.push(`whatsapp: ${err?.message ?? String(err)}`);
      }
    }
  }

  const anySuccess = emailSent || whatsappSent;
  await supabase
    .from('ai_sales_proposals')
    .update({
      status: anySuccess ? 'sent' : 'failed',
      sentAt: anySuccess ? new Date().toISOString() : null,
      errorMessage: errors.length > 0 ? errors.join('; ') : null,
    })
    .eq('id', proposal.id);

  return { emailSent, whatsappSent, errors };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Prospect CRUD ─────────────────────────────────────────────

export async function listProspects(companyId: string): Promise<Prospect[]> {
  const supabase = getSupabaseClient();
  let q = supabase.from('prospects').select('*').order('createdAt', { ascending: false });
  if (companyId !== 'ALL') q = q.eq('"companyId"', companyId);
  const { data, error } = await q;
  if (error) throw new Error(`Failed to list prospects: ${error.message}`);
  return (data ?? []) as Prospect[];
}

export async function createProspect(p: Omit<Prospect, 'id' | 'createdAt'>): Promise<Prospect> {
  const supabase = getSupabaseClient();
  const row: Prospect = {
    ...p,
    id: `pr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  const { error } = await supabase.from('prospects').insert(row);
  if (error) throw new Error(`Failed to create prospect: ${error.message}`);
  return row;
}

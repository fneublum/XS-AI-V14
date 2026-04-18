// Phase 3B — Row-level email compose drawer.
//
// Opens pre-filled with recipient / subject / body based on the row
// (an order, invoice, or packing list). Send hands off to the user's
// mail client via a mailto: link. This is the minimum-viable email
// action — Phase 3C can replace the mailto hand-off with the in-app
// Smail + Gmail/Graph flow that v1 already supports.

import React, { useEffect, useState } from 'react';
import { Drawer, Input, FormField, Label, Button, Badge } from '../primitives';
import { useToast } from '../primitives/Toast';

export interface EmailDraft {
  to: string;
  cc?: string;
  subject: string;
  body: string;
  /** Shown in the drawer subtitle (e.g. "Invoice INV-123") for context. */
  contextLabel?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: EmailDraft | null;
}

const buildMailto = (d: EmailDraft): string => {
  const params = new URLSearchParams();
  if (d.subject) params.set('subject', d.subject);
  if (d.body) params.set('body', d.body);
  if (d.cc) params.set('cc', d.cc);
  const qs = params.toString().replace(/\+/g, '%20');
  return `mailto:${encodeURIComponent(d.to)}${qs ? '?' + qs : ''}`;
};

export const EmailComposeDrawer: React.FC<Props> = ({ open, onOpenChange, draft }) => {
  const toast = useToast();
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    if (!draft) return;
    setTo(draft.to);
    setCc(draft.cc ?? '');
    setSubject(draft.subject);
    setBody(draft.body);
  }, [draft]);

  const valid = to.trim() !== '' && subject.trim() !== '';

  const send = () => {
    const d: EmailDraft = { to: to.trim(), cc: cc.trim() || undefined, subject, body };
    const href = buildMailto(d);
    try {
      window.open(href, '_blank');
      toast.push({
        kind: 'success',
        title: 'Opened in mail client',
        description: `${d.to}`,
      });
      onOpenChange(false);
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Could not open mail client',
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Send email"
      description={draft?.contextLabel}
      footer={
        <>
          <Button
            variant="secondary" size="sm"
            onClick={() => onOpenChange(false)}
            className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={send}
            disabled={!valid}
            className="ml-auto bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
          >
            Open in mail client
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField>
          <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
            To <span className="text-red-400">*</span>
          </Label>
          <Input
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder="customer@example.com"
            className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200"
          />
        </FormField>

        <FormField>
          <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
            CC
          </Label>
          <Input
            value={cc}
            onChange={e => setCc(e.target.value)}
            placeholder="optional@example.com"
            className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200"
          />
        </FormField>

        <FormField>
          <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
            Subject <span className="text-red-400">*</span>
          </Label>
          <Input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200"
          />
        </FormField>

        <FormField>
          <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
            Body
          </Label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={10}
            className="bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12.5px] text-slate-200 placeholder:text-slate-600 resize-y leading-relaxed"
          />
        </FormField>

        <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-2">
          <Badge variant="neutral">mailto</Badge>
          <span className="text-slate-600">
            opens your default mail client; attach PDFs from the Inspect drawer
          </span>
        </div>
      </div>
    </Drawer>
  );
};

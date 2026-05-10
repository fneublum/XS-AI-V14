/**
 * Brain Service — Centralized AI Orchestrator
 * =============================================
 * The unified brain for XS-AI-ERP. Every AI interaction across the platform
 * flows through this service, creating a closed learning loop:
 *
 *   Interaction → Context → AI Response → User Outcome → Learning → Better Context
 *
 * Features:
 * 1. Context Builder    — Combines memory, activity logs, preferences, and insights
 * 2. Interaction Logger — Unified log for every AI call across all services
 * 3. Outcome Tracker    — Records user decisions (approve/dismiss/modify/ignore)
 * 4. Learning Engine    — Extracts patterns from outcomes → stores as insights
 * 5. HALL Memory Bridge — Selective bi-directional sync with HALL's external memory
 * 6. Brain Stats        — Health metrics and learning progress
 */

import { getSupabaseClient } from './supabase';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
    smartRecall,
    buildMemoryContext,
    storeMemory,
    getMemoryStats,
    runMemoryMaintenance,
    type AIMemory,
    type MemoryCategory
} from './memoryService';

// ─── Types ──────────────────────────────────────────────────────────────────

export type InteractionSource =
    | 'email_agent'       // AI Email Agent drafts/followups
    | 'copilot'           // XS Agent chat sidebar
    | 'workflow'          // Automated workflow actions
    | 'document'          // Document processing (OCR, extraction)
    | 'logistics'         // Logistics AI actions
    | 'sales'             // Sales AI assistant
    | 'hall'              // HALL Brain API interactions
    | 'system';           // Internal system events

export type InteractionType =
    | 'draft_reply'       // Email draft generated
    | 'followup_draft'    // Follow-up email generated
    | 'crud_action'       // AI-executed CRUD (create customer, etc.)
    | 'analysis'          // Data analysis / insight
    | 'recommendation'    // AI recommendation (pricing, routing)
    | 'document_extract'  // Document data extraction
    | 'po_processing'     // Purchase order auto-processing
    | 'conversation'      // Chat conversation exchange
    | 'workflow_action';  // Automated workflow execution

export type OutcomeType =
    | 'approved'          // User approved the AI output
    | 'dismissed'         // User dismissed/rejected
    | 'modified'          // User modified then used
    | 'failed'            // Action failed (error)
    | 'auto_completed'    // No user action needed (info only)
    | 'ignored'           // User never acted
    | 'pending';          // Awaiting user decision

export interface InteractionParams {
    source: InteractionSource;
    type: InteractionType;
    userId: string;
    companyId: string;
    inputSummary: string;       // What the AI was asked/triggered by
    outputSummary: string;      // What the AI produced
    contextUsed?: string;       // What context was provided
    metadata?: Record<string, any>; // Source-specific extra data
}

export interface OutcomeData {
    outcome: OutcomeType;
    details?: Record<string, any>;  // e.g., { editedReply: '...' } for 'modified'
    userFeedback?: string;          // Explicit user feedback if given
}

export interface BrainInteraction {
    id: string;
    user_id: string;
    company_id: string;
    source: InteractionSource;
    interaction_type: InteractionType;
    input_summary: string;
    output_summary: string;
    context_used: string | null;
    outcome: OutcomeType | null;
    outcome_details: Record<string, any>;
    importance: number;
    created_at: string;
    resolved_at: string | null;
}

export interface LearnedInsight {
    pattern: string;
    confidence: number;
    source: InteractionSource;
    actionRecommendation: string;
    exampleCount: number;
}

export interface BrainContext {
    memoryContext: string;        // From memoryService
    recentInsights: string[];    // Learned patterns relevant to topic
    activitySummary: string;     // Recent activity patterns
    preferences: string[];       // User preferences
    fullContext: string;         // Combined string ready for AI prompt injection
}

export interface BrainStats {
    totalInteractions: number;
    outcomeBreakdown: Record<string, number>;
    approvalRate: number;
    topSources: { source: string; count: number }[];
    insightsGenerated: number;
    memoryStats: { total: number; byCategory: Record<string, number> };
    lastLearningRun: string | null;
    hallSyncStatus: 'connected' | 'disconnected' | 'unknown';
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TABLE_NAME = 'brain_interactions';
const INSIGHT_MEMORY_SOURCE = 'brain-learning';
const HALL_SUPABASE_URL = import.meta.env.VITE_HALL_SUPABASE_URL ?? '';
const HALL_SUPABASE_ANON_KEY = import.meta.env.VITE_HALL_SUPABASE_ANON_KEY ?? '';

// ─── Brain Service Singleton ────────────────────────────────────────────────

class BrainService {
    private hallClient: SupabaseClient | null = null;
    private lastLearningRun: string | null = null;
    private insightCache: Map<string, { insights: LearnedInsight[]; timestamp: number }> = new Map();
    private readonly INSIGHT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

    // ═══════════════════════════════════════════════════════════════════════
    // 1. CONTEXT BUILDER
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Build rich context for any AI call. Combines:
     * - Memory recall (topic-relevant memories + preferences)
     * - Learned insights from brain interactions
     * - Recent activity patterns
     *
     * This replaces standalone context builders in individual services.
     */
    async buildContext(
        userId: string,
        topic: string,
        source?: InteractionSource
    ): Promise<BrainContext> {
        const [memoryContext, insights, activitySummary, preferences] = await Promise.all([
            buildMemoryContext(userId, topic),
            this.getInsights(userId, topic, source),
            this.getActivitySummary(userId),
            this.getUserPreferences(userId)
        ]);

        const insightLines = insights.map(i =>
            `  • [${i.source}] (${Math.round(i.confidence * 100)}% conf) ${i.pattern} → ${i.actionRecommendation}`
        );

        const parts: string[] = [];

        if (memoryContext) {
            parts.push(memoryContext);
        }

        if (insightLines.length > 0) {
            parts.push(`\nLEARNED INSIGHTS — Patterns observed from this user's past decisions:\n${insightLines.join('\n')}`);
        }

        if (activitySummary) {
            parts.push(`\nRECENT ACTIVITY:\n${activitySummary}`);
        }

        if (preferences.length > 0) {
            parts.push(`\nUSER PREFERENCES:\n${preferences.map(p => `  • ${p}`).join('\n')}`);
        }

        return {
            memoryContext,
            recentInsights: insights.map(i => i.pattern),
            activitySummary,
            preferences,
            fullContext: parts.join('\n')
        };
    }

    /**
     * Get user preferences from memory.
     */
    private async getUserPreferences(userId: string): Promise<string[]> {
        try {
            const supabase = getSupabaseClient();
            const { data } = await supabase
                .from('ai_memories')
                .select('content')
                .eq('user_id', userId)
                .eq('category', 'preference')
                .order('importance', { ascending: false })
                .limit(8);

            return (data || []).map((p: any) => p.content);
        } catch {
            return [];
        }
    }

    /**
     * Summarize recent user activity patterns from activity logs.
     */
    private async getActivitySummary(userId: string): Promise<string> {
        try {
            const supabase = getSupabaseClient();
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // Last 24h

            const { data } = await supabase
                .from('activity_logs')
                .select('event_category, event_action, module, entity_type, timestamp')
                .eq('user_id', userId)
                .gte('timestamp', since)
                .order('timestamp', { ascending: false })
                .limit(30);

            if (!data || data.length === 0) return '';

            // Aggregate by module
            const moduleCounts: Record<string, number> = {};
            const actionCounts: Record<string, number> = {};

            for (const entry of data) {
                if (entry.module) {
                    moduleCounts[entry.module] = (moduleCounts[entry.module] || 0) + 1;
                }
                const key = `${entry.event_action} ${entry.entity_type || ''}`.trim();
                actionCounts[key] = (actionCounts[key] || 0) + 1;
            }

            const topModules = Object.entries(moduleCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([mod, count]) => `${mod} (${count}x)`)
                .join(', ');

            const topActions = Object.entries(actionCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4)
                .map(([action, count]) => `${action} (${count}x)`)
                .join(', ');

            return `  Active modules: ${topModules || 'none'}\n  Recent actions: ${topActions || 'none'}`;
        } catch {
            return '';
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 2. INTERACTION LOGGER
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Log an AI interaction from any source.
     * Returns an interactionId for later outcome tracking.
     */
    async logInteraction(params: InteractionParams): Promise<string> {
        try {
            const supabase = getSupabaseClient();
            const id = crypto.randomUUID();

            const { error } = await supabase
                .from(TABLE_NAME)
                .insert({
                    id,
                    user_id: params.userId,
                    company_id: params.companyId,
                    source: params.source,
                    interaction_type: params.type,
                    input_summary: params.inputSummary.substring(0, 500),
                    output_summary: params.outputSummary.substring(0, 1000),
                    context_used: params.contextUsed?.substring(0, 2000) || null,
                    outcome: 'pending',
                    outcome_details: params.metadata || {},
                    importance: 0.5,
                    created_at: new Date().toISOString(),
                    resolved_at: null
                });

            if (error) {
                console.warn('[Brain] Log interaction failed (table may not exist):', error.message);
                // Graceful fallback — store in memory instead
                await storeMemory(
                    params.userId,
                    `[${params.source}/${params.type}] ${params.inputSummary.substring(0, 200)}`,
                    'conversation',
                    `brain-${params.source}`,
                    0.5
                );
                return `mem-${Date.now()}`;
            }

            return id;
        } catch (e: any) {
            console.error('[Brain] logInteraction error:', e.message);
            return `err-${Date.now()}`;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 3. OUTCOME TRACKER
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Record the outcome of a previously logged interaction.
     * This is the key feedback signal for the learning engine.
     */
    async trackOutcome(interactionId: string, outcome: OutcomeData): Promise<void> {
        try {
            // Skip if it's a fallback ID (memory-based or error-based)
            if (interactionId.startsWith('mem-') || interactionId.startsWith('err-')) {
                return;
            }

            const supabase = getSupabaseClient();
            const { error } = await supabase
                .from(TABLE_NAME)
                .update({
                    outcome: outcome.outcome,
                    outcome_details: outcome.details || {},
                    resolved_at: new Date().toISOString(),
                    // Boost importance for interactions that got user attention
                    importance: outcome.outcome === 'approved' ? 0.8 :
                               outcome.outcome === 'modified' ? 0.9 :  // Modified = user engaged deeply
                               outcome.outcome === 'dismissed' ? 0.6 :
                               0.5
                })
                .eq('id', interactionId);

            if (error) {
                console.warn('[Brain] trackOutcome failed:', error.message);
            }

            // If user modified the output, store the modification as a learning signal
            if (outcome.outcome === 'modified' && outcome.details?.editedContent) {
                const { data: interaction } = await supabase
                    .from(TABLE_NAME)
                    .select('user_id, source, input_summary, output_summary')
                    .eq('id', interactionId)
                    .single();

                if (interaction) {
                    await storeMemory(
                        interaction.user_id,
                        `User corrected AI ${interaction.source} output. Original: "${interaction.output_summary.substring(0, 100)}..." → Modified to: "${outcome.details.editedContent.substring(0, 100)}"`,
                        'instruction',
                        INSIGHT_MEMORY_SOURCE,
                        0.85
                    );
                }
            }
        } catch (e: any) {
            console.error('[Brain] trackOutcome error:', e.message);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 4. LEARNING ENGINE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Analyze tracked outcomes and extract learnable patterns.
     * Called periodically (on dashboard mount, or manually).
     *
     * Patterns detected:
     * - High dismiss rate for a source → adjust tone/approach
     * - Consistent modifications → learn the user's preferred style
     * - Approval patterns by sender/topic → auto-prioritize
     */
    async learnFromOutcomes(userId: string): Promise<LearnedInsight[]> {
        try {
            const supabase = getSupabaseClient();
            const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // Last 7 days

            const { data: interactions, error } = await supabase
                .from(TABLE_NAME)
                .select('*')
                .eq('user_id', userId)
                .gte('created_at', since)
                .not('outcome', 'is', null)
                .not('outcome', 'eq', 'pending')
                .order('created_at', { ascending: false })
                .limit(200);

            if (error || !interactions || interactions.length < 5) {
                return []; // Not enough data to learn from
            }

            const insights: LearnedInsight[] = [];

            // ── Pattern 1: Source-level approval/dismiss rates ──
            const sourceStats: Record<string, { approved: number; dismissed: number; modified: number; total: number }> = {};
            for (const interaction of interactions) {
                const src = interaction.source;
                if (!sourceStats[src]) sourceStats[src] = { approved: 0, dismissed: 0, modified: 0, total: 0 };
                sourceStats[src].total++;
                if (interaction.outcome === 'approved') sourceStats[src].approved++;
                if (interaction.outcome === 'dismissed') sourceStats[src].dismissed++;
                if (interaction.outcome === 'modified') sourceStats[src].modified++;
            }

            for (const [source, stats] of Object.entries(sourceStats)) {
                if (stats.total < 3) continue;

                const approvalRate = stats.approved / stats.total;
                const dismissRate = stats.dismissed / stats.total;
                const modifyRate = stats.modified / stats.total;

                if (dismissRate > 0.6) {
                    insights.push({
                        pattern: `User dismisses ${Math.round(dismissRate * 100)}% of ${source} AI outputs`,
                        confidence: Math.min(0.95, 0.5 + (stats.total / 50)),
                        source: source as InteractionSource,
                        actionRecommendation: 'Be more conservative. Only draft when confidence is very high.',
                        exampleCount: stats.total
                    });
                }

                if (approvalRate > 0.8) {
                    insights.push({
                        pattern: `User approves ${Math.round(approvalRate * 100)}% of ${source} outputs — high trust`,
                        confidence: Math.min(0.95, 0.5 + (stats.total / 50)),
                        source: source as InteractionSource,
                        actionRecommendation: 'Current approach is working well. Maintain quality and consider auto-actions.',
                        exampleCount: stats.total
                    });
                }

                if (modifyRate > 0.4) {
                    insights.push({
                        pattern: `User modifies ${Math.round(modifyRate * 100)}% of ${source} outputs before using`,
                        confidence: Math.min(0.95, 0.5 + (stats.total / 50)),
                        source: source as InteractionSource,
                        actionRecommendation: 'AI output needs adjustment. Check user correction patterns for style guidance.',
                        exampleCount: stats.total
                    });
                }
            }

            // ── Pattern 2: Email-specific patterns (sender-based) ──
            const emailInteractions = interactions.filter(i =>
                i.source === 'email_agent' && i.outcome_details?.senderEmail
            );

            if (emailInteractions.length >= 3) {
                const senderPatterns: Record<string, { approved: number; dismissed: number }> = {};

                for (const ei of emailInteractions) {
                    const sender = ei.outcome_details.senderEmail;
                    if (!senderPatterns[sender]) senderPatterns[sender] = { approved: 0, dismissed: 0 };
                    if (ei.outcome === 'approved') senderPatterns[sender].approved++;
                    if (ei.outcome === 'dismissed') senderPatterns[sender].dismissed++;
                }

                for (const [sender, stats] of Object.entries(senderPatterns)) {
                    const total = stats.approved + stats.dismissed;
                    if (total < 2) continue;

                    if (stats.dismissed / total > 0.8) {
                        insights.push({
                            pattern: `User always dismisses emails from ${sender}`,
                            confidence: 0.7 + (total / 20),
                            source: 'email_agent',
                            actionRecommendation: `Consider auto-dismissing or lowering priority for emails from ${sender}`,
                            exampleCount: total
                        });
                    }
                }
            }

            // ── Store insights as memories for future context ──
            for (const insight of insights) {
                await storeMemory(
                    userId,
                    `BRAIN INSIGHT: ${insight.pattern}. Recommendation: ${insight.actionRecommendation}`,
                    'instruction',
                    INSIGHT_MEMORY_SOURCE,
                    Math.min(0.95, insight.confidence)
                );
            }

            this.lastLearningRun = new Date().toISOString();
            // Clear insight cache to force refresh
            this.insightCache.delete(userId);

            console.log(`[Brain] Learning complete for ${userId}: ${insights.length} insights from ${interactions.length} interactions`);
            return insights;
        } catch (e: any) {
            console.error('[Brain] learnFromOutcomes error:', e.message);
            return [];
        }
    }

    /**
     * Get relevant insights for a given topic and source.
     * Uses cached results within TTL.
     */
    async getInsights(
        userId: string,
        topic: string,
        source?: InteractionSource
    ): Promise<LearnedInsight[]> {
        // Check cache
        const cached = this.insightCache.get(userId);
        if (cached && Date.now() - cached.timestamp < this.INSIGHT_CACHE_TTL) {
            return source
                ? cached.insights.filter(i => i.source === source)
                : cached.insights;
        }

        // Fetch from memory (brain insights are stored as 'instruction' with source 'brain-learning')
        const { memories } = await smartRecall(userId, `brain insight ${topic} ${source || ''}`, 10);

        const insights: LearnedInsight[] = memories
            .filter(m => m.source === INSIGHT_MEMORY_SOURCE)
            .map(m => {
                // Parse stored insight format: "BRAIN INSIGHT: <pattern>. Recommendation: <rec>"
                const patternMatch = m.content.match(/BRAIN INSIGHT: (.+?)\. Recommendation: (.+)/);
                return {
                    pattern: patternMatch ? patternMatch[1] : m.content,
                    confidence: m.importance,
                    source: (m.source || 'system') as InteractionSource,
                    actionRecommendation: patternMatch ? patternMatch[2] : '',
                    exampleCount: m.access_count || 1
                };
            });

        // Cache
        this.insightCache.set(userId, { insights, timestamp: Date.now() });

        return source
            ? insights.filter(i => i.source === source)
            : insights;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 5. HALL MEMORY BRIDGE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Selective sync with HALL's external Supabase.
     * - Pushes: High-importance brain insights and user preferences
     * - Pulls: HALL's conversation learnings relevant to this user
     */
    async syncWithHall(userId: string): Promise<{ pushed: number; pulled: number }> {
        try {
            const hallDb = this.getHallClient();
            const supabase = getSupabaseClient();
            let pushed = 0;
            let pulled = 0;

            // ── PUSH: Send high-importance insights to HALL ──
            const { data: importantMemories } = await supabase
                .from('ai_memories')
                .select('content, category, importance, created_at')
                .eq('user_id', userId)
                .in('category', ['instruction', 'preference', 'fact'])
                .gte('importance', 0.7)
                .order('created_at', { ascending: false })
                .limit(20);

            if (importantMemories && importantMemories.length > 0) {
                // Get or create xs-crm conversation in HALL's DB
                const { data: conv } = await hallDb
                    .from('conversations')
                    .select('id')
                    .eq('phone_number', 'xs-crm')
                    .limit(1);

                const conversationId = conv?.[0]?.id;

                if (conversationId) {
                    // Push as a structured message
                    const memoryReport = importantMemories
                        .map((m: any) => `[${m.category}] ${m.content}`)
                        .join('\n');

                    await hallDb.from('messages').insert({
                        id: crypto.randomUUID(),
                        conversation_id: conversationId,
                        content: `🧠 XS Platform Brain Sync (${importantMemories.length} items):\n${memoryReport}`,
                        direction: 'outbound',
                        channel: 'web',
                        message_type: 'text',
                        status: 'delivered',
                        metadata: { source: 'xs-brain-sync', syncType: 'push', userId }
                    });
                    pushed = importantMemories.length;
                }
            }

            // ── PULL: Get recent HALL learnings about this user ──
            const { data: hallMessages } = await hallDb
                .from('messages')
                .select('content, created_at, metadata')
                .eq('direction', 'inbound')  // HALL's responses
                .order('created_at', { ascending: false })
                .limit(20);

            if (hallMessages && hallMessages.length > 0) {
                // Look for relevant knowledge to import
                for (const msg of hallMessages) {
                    const content = msg.content || '';
                    // Only pull messages that contain structured knowledge
                    if (content.length > 50 && (
                        content.toLowerCase().includes('learned') ||
                        content.toLowerCase().includes('pattern') ||
                        content.toLowerCase().includes('preference') ||
                        content.toLowerCase().includes('remember')
                    )) {
                        // Check if we already have this knowledge
                        const { memories } = await smartRecall(userId, content.substring(0, 100), 3);
                        const isDuplicate = memories.some(m =>
                            m.content.includes(content.substring(0, 50))
                        );

                        if (!isDuplicate) {
                            await storeMemory(
                                userId,
                                `[from HALL] ${content.substring(0, 300)}`,
                                'fact',
                                'hall-sync',
                                0.6
                            );
                            pulled++;
                        }
                    }
                }
            }

            console.log(`[Brain] HALL sync: pushed ${pushed}, pulled ${pulled} items`);
            return { pushed, pulled };
        } catch (e: any) {
            console.error('[Brain] HALL sync error:', e.message);
            return { pushed: 0, pulled: 0 };
        }
    }

    private getHallClient(): SupabaseClient {
        if (!this.hallClient) {
            this.hallClient = createClient(HALL_SUPABASE_URL, HALL_SUPABASE_ANON_KEY);
        }
        return this.hallClient;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 6. BRAIN STATS & MAINTENANCE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Get comprehensive brain health and learning stats.
     */
    async getBrainStats(userId: string): Promise<BrainStats> {
        try {
            const supabase = getSupabaseClient();

            const [interactionsResult, memStats, hallStatus] = await Promise.all([
                supabase
                    .from(TABLE_NAME)
                    .select('source, outcome')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(500),
                getMemoryStats(userId),
                this.checkHallConnection()
            ]);

            const interactions = interactionsResult.data || [];

            // Outcome breakdown
            const outcomeBreakdown: Record<string, number> = {};
            const sourceCounts: Record<string, number> = {};

            for (const i of interactions) {
                const outcome = i.outcome || 'pending';
                outcomeBreakdown[outcome] = (outcomeBreakdown[outcome] || 0) + 1;
                sourceCounts[i.source] = (sourceCounts[i.source] || 0) + 1;
            }

            const totalResolved = (outcomeBreakdown['approved'] || 0) +
                                  (outcomeBreakdown['dismissed'] || 0) +
                                  (outcomeBreakdown['modified'] || 0);
            const approvalRate = totalResolved > 0
                ? (outcomeBreakdown['approved'] || 0) / totalResolved
                : 0;

            const topSources = Object.entries(sourceCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([source, count]) => ({ source, count }));

            // Count insights (instruction memories from brain-learning)
            const { data: insightData } = await supabase
                .from('ai_memories')
                .select('id')
                .eq('user_id', userId)
                .eq('source', INSIGHT_MEMORY_SOURCE);

            return {
                totalInteractions: interactions.length,
                outcomeBreakdown,
                approvalRate: Math.round(approvalRate * 100) / 100,
                topSources,
                insightsGenerated: insightData?.length || 0,
                memoryStats: {
                    total: memStats.total,
                    byCategory: memStats.byCategory
                },
                lastLearningRun: this.lastLearningRun,
                hallSyncStatus: hallStatus
            };
        } catch (e: any) {
            console.error('[Brain] Stats error:', e.message);
            return {
                totalInteractions: 0,
                outcomeBreakdown: {},
                approvalRate: 0,
                topSources: [],
                insightsGenerated: 0,
                memoryStats: { total: 0, byCategory: {} },
                lastLearningRun: null,
                hallSyncStatus: 'unknown'
            };
        }
    }

    /**
     * Run full brain maintenance cycle:
     * - Memory maintenance (decay + summarization)
     * - Learning from recent outcomes
     * - HALL sync
     */
    async runMaintenance(userId: string): Promise<void> {
        console.log('[Brain] Starting maintenance cycle for', userId);

        try {
            await Promise.all([
                runMemoryMaintenance(userId),
                this.learnFromOutcomes(userId)
            ]);

            // HALL sync is lower priority, run separately
            this.syncWithHall(userId).catch(() => { });

            console.log('[Brain] Maintenance cycle complete');
        } catch (e: any) {
            console.error('[Brain] Maintenance error:', e.message);
        }
    }

    /**
     * Check HALL connection status.
     */
    private async checkHallConnection(): Promise<'connected' | 'disconnected' | 'unknown'> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(
                'https://gen-lang-client-0755290444.ue.r.appspot.com/health',
                { signal: controller.signal }
            ).catch(() => null);

            clearTimeout(timeoutId);
            return response?.ok ? 'connected' : 'disconnected';
        } catch {
            return 'unknown';
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 7. CONVENIENCE METHODS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Quick log + track for simple fire-and-forget interactions.
     * Returns the interactionId for optional outcome tracking.
     */
    async quickLog(
        source: InteractionSource,
        type: InteractionType,
        userId: string,
        companyId: string,
        input: string,
        output: string,
        outcome?: OutcomeType
    ): Promise<string> {
        const id = await this.logInteraction({
            source, type, userId, companyId,
            inputSummary: input,
            outputSummary: output
        });

        if (outcome && outcome !== 'pending') {
            await this.trackOutcome(id, { outcome });
        }

        return id;
    }

    /**
     * Store a direct learning/instruction from user behavior.
     * Higher importance than auto-detected patterns.
     */
    async learnDirectly(
        userId: string,
        lesson: string,
        source: InteractionSource = 'system'
    ): Promise<void> {
        await storeMemory(
            userId,
            `DIRECT LEARNING [${source}]: ${lesson}`,
            'instruction',
            INSIGHT_MEMORY_SOURCE,
            0.9
        );
        // Clear insight cache
        this.insightCache.delete(userId);
    }
}

// ─── Singleton Export ───────────────────────────────────────────────────────

export const brainService = new BrainService();

// Make available in browser console for debugging
if (typeof window !== 'undefined') {
    (window as any).brainService = brainService;
}

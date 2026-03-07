/**
 * XS AI Advanced Memory Service
 * ==============================
 * Full cognitive memory system with:
 * 1. Smart Search — tokenized multi-keyword relevance scoring
 * 2. Session Persistence — save/restore full chat history
 * 3. User Preference Learning — auto-detect recurring patterns
 * 4. Memory Summarization — compress old memories
 * 5. Memory Decay — reduce unaccessed memory importance
 * 6. Enhanced Context — topic-aware memory injection
 */

import { getSupabaseClient } from './supabase';

// ─── Types ──────────────────────────────────────────────────────────
export type MemoryCategory = 'conversation' | 'fact' | 'preference' | 'instruction' | 'general' | 'summary';

export interface AIMemory {
    id: string;
    user_id: string;
    content: string;
    category: MemoryCategory;
    source: string;
    importance: number;
    access_count: number;
    last_accessed: string;
    created_at: string;
    updated_at: string;
}

export interface ChatMessage {
    role: 'user' | 'model';
    text: string;
    timestamp: string;
}

export interface ChatSession {
    id: string;
    user_id: string;
    messages: ChatMessage[];
    summary: string | null;
    started_at: string;
    updated_at: string;
}

export interface MemoryStats {
    total: number;
    byCategory: Record<string, number>;
    oldest: string | null;
    newest: string | null;
    totalAccesses: number;
    averageImportance: number;
}

// ═════════════════════════════════════════════════════════════════════
// 1. SMART SEARCH — tokenized multi-keyword relevance scoring
// ═════════════════════════════════════════════════════════════════════

/**
 * Smart recall that tokenizes the query, searches across all keywords,
 * and ranks results by: keyword overlap × importance × recency weight.
 */
export async function smartRecall(
    userId: string,
    query: string,
    limit: number = 10
): Promise<{ memories: AIMemory[]; error?: string }> {
    try {
        const supabase = getSupabaseClient();

        // Tokenize: remove stop words, extract meaningful keywords
        const tokens = tokenize(query);
        if (tokens.length === 0) {
            return await getRecentMemories(userId, limit).then(m => ({ memories: m }));
        }

        // Fetch candidate memories (broader search)
        const { data, error } = await supabase
            .from('ai_memories')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(200); // Fetch more, then score locally

        if (error) throw error;
        if (!data || data.length === 0) return { memories: [] };

        // Score each memory by relevance
        const scored = (data as AIMemory[]).map(memory => {
            const score = calculateRelevanceScore(memory, tokens);
            return { memory, score };
        });

        // Sort by score descending, take top N
        scored.sort((a, b) => b.score - a.score);
        const topMemories = scored
            .filter(s => s.score > 0)
            .slice(0, limit)
            .map(s => s.memory);

        // Update access timestamps for returned memories (fire and forget)
        if (topMemories.length > 0) {
            const ids = topMemories.map(m => m.id);
            supabase
                .from('ai_memories')
                .update({ last_accessed: new Date().toISOString() })
                .in('id', ids)
                .then(() => { }); // fire and forget
        }

        return { memories: topMemories };
    } catch (e: any) {
        console.error('[MemoryService] Smart recall failed:', e.message);
        return { memories: [], error: e.message };
    }
}

function calculateRelevanceScore(memory: AIMemory, tokens: string[]): number {
    const contentLower = memory.content.toLowerCase();

    // 1. Keyword overlap score (0-1)
    let matchCount = 0;
    for (const token of tokens) {
        if (contentLower.includes(token)) matchCount++;
    }
    const keywordScore = tokens.length > 0 ? matchCount / tokens.length : 0;
    if (keywordScore === 0) return 0; // No match at all

    // 2. Importance weight (0.1 - 1.0)
    const importanceWeight = Math.max(0.1, memory.importance || 0.5);

    // 3. Recency weight — newer memories score higher
    const ageMs = Date.now() - new Date(memory.created_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const recencyWeight = Math.max(0.1, 1 - (ageDays / 90)); // Decays over 90 days

    // 4. Category boost — preferences and facts are more valuable for context
    const categoryBoost = memory.category === 'preference' ? 1.3 :
        memory.category === 'fact' ? 1.2 :
            memory.category === 'instruction' ? 1.1 : 1.0;

    return keywordScore * importanceWeight * recencyWeight * categoryBoost;
}

function tokenize(text: string): string[] {
    const stopWords = new Set([
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
        'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'like',
        'through', 'after', 'over', 'between', 'out', 'against', 'during',
        'it', 'its', 'this', 'that', 'these', 'those', 'i', 'me', 'my',
        'you', 'your', 'he', 'she', 'we', 'they', 'what', 'which', 'who',
        'when', 'where', 'how', 'not', 'no', 'but', 'or', 'and', 'if',
        'then', 'so', 'up', 'just', 'also', 'than', 'very', 'too'
    ]);

    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w));
}

// ═════════════════════════════════════════════════════════════════════
// 2. SESSION PERSISTENCE — save/restore chat history
// ═════════════════════════════════════════════════════════════════════

/**
 * Load the most recent chat session for a user, or create a new one.
 */
export async function loadSession(userId: string): Promise<ChatSession | null> {
    try {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
            .from('ai_chat_sessions')
            .select('*')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false })
            .limit(1)
            .single();

        if (error || !data) return null;

        return {
            ...data,
            messages: Array.isArray(data.messages) ? data.messages : []
        } as ChatSession;
    } catch {
        return null;
    }
}

/**
 * Save/update the current chat session.
 */
export async function saveSession(
    userId: string,
    messages: ChatMessage[],
    sessionId?: string
): Promise<string | null> {
    try {
        const supabase = getSupabaseClient();

        if (sessionId) {
            // Update existing session
            await supabase
                .from('ai_chat_sessions')
                .update({
                    messages,
                    updated_at: new Date().toISOString()
                })
                .eq('id', sessionId);
            return sessionId;
        } else {
            // Create new session
            const { data, error } = await supabase
                .from('ai_chat_sessions')
                .insert({
                    user_id: userId,
                    messages,
                    started_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .select('id')
                .single();

            if (error) throw error;
            return data?.id || null;
        }
    } catch (e: any) {
        console.error('[MemoryService] Save session failed:', e.message);
        return null;
    }
}

/**
 * Summarize a session into a compact string for memory storage.
 */
export function summarizeSession(messages: ChatMessage[]): string {
    if (messages.length === 0) return '';

    const userMessages = messages
        .filter(m => m.role === 'user')
        .map(m => m.text.substring(0, 80));

    const topics = userMessages.slice(-5); // Last 5 user messages as topics
    return `Session topics: ${topics.join(' | ')}`;
}

// ═════════════════════════════════════════════════════════════════════
// 3. USER PREFERENCE LEARNING — auto-detect recurring patterns
// ═════════════════════════════════════════════════════════════════════

/**
 * Analyzes recent conversation exchanges and detects recurring patterns:
 * - Frequently mentioned entities (customers, ports, products)
 * - Preferred formats or response styles
 * - Common request types
 */
export async function detectAndStorePreferences(
    userId: string,
    userMessage: string,
    aiResponse: string
): Promise<void> {
    try {
        // Extract potential preferences from the exchange
        const preferences = extractPreferences(userMessage, aiResponse);
        if (preferences.length === 0) return;

        const supabase = getSupabaseClient();

        for (const pref of preferences) {
            // Check if we already have a similar preference
            const { data: existing } = await supabase
                .from('ai_memories')
                .select('id, content, importance, access_count')
                .eq('user_id', userId)
                .eq('category', 'preference')
                .ilike('content', `%${pref.key}%`)
                .limit(1);

            if (existing && existing.length > 0) {
                // Reinforce existing preference — bump importance
                const current = existing[0];
                const newImportance = Math.min(1.0, (current.importance || 0.5) + 0.05);
                await supabase
                    .from('ai_memories')
                    .update({
                        importance: newImportance,
                        access_count: (current.access_count || 0) + 1,
                        last_accessed: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', current.id);
            } else {
                // Store new preference
                await storeMemory(userId, pref.content, 'preference', 'auto-learn', 0.7);
            }
        }
    } catch (e: any) {
        console.error('[MemoryService] Preference detection failed:', e.message);
    }
}

interface DetectedPreference {
    key: string;
    content: string;
}

function extractPreferences(userMsg: string, aiResponse: string): DetectedPreference[] {
    const prefs: DetectedPreference[] = [];
    const combined = `${userMsg} ${aiResponse}`.toLowerCase();

    // Detect customer mentions with action patterns
    const customerPattern = /(?:customer|client|buyer|for)\s+(\w+(?:\s+\w+)?)/gi;
    let match;
    const seenCustomers = new Set<string>();
    while ((match = customerPattern.exec(combined)) !== null) {
        const name = match[1].trim();
        if (name.length > 2 && name.length < 30 && !seenCustomers.has(name)) {
            seenCustomers.add(name);
            prefs.push({
                key: name,
                content: `User frequently works with customer: ${name}`
            });
        }
    }

    // Detect shipping/port preferences
    const portPattern = /(?:port|ship to|destination|export|import)\s+(?:of\s+)?(\w+(?:\s+\w+)?)/gi;
    while ((match = portPattern.exec(combined)) !== null) {
        const port = match[1].trim();
        if (port.length > 2 && port.length < 30) {
            prefs.push({
                key: `port ${port}`,
                content: `User frequently references port/destination: ${port}`
            });
        }
    }

    // Detect currency preferences
    const currencyPattern = /(?:price|cost|amount|total|pay)\s+(?:in\s+)?(USD|EUR|GTQ|BRL|MXN)/gi;
    while ((match = currencyPattern.exec(combined)) !== null) {
        prefs.push({
            key: `currency ${match[1]}`,
            content: `User prefers working with currency: ${match[1].toUpperCase()}`
        });
    }

    // Limit to avoid flooding
    return prefs.slice(0, 3);
}

// ═════════════════════════════════════════════════════════════════════
// 4. MEMORY SUMMARIZATION — compress old memories
// ═════════════════════════════════════════════════════════════════════

/**
 * Compress memories older than `daysOld` days into summaries.
 * Groups by category, creates summary entries, deletes originals.
 */
export async function summarizeOldMemories(
    userId: string,
    daysOld: number = 7
): Promise<{ summarized: number; created: number }> {
    try {
        const supabase = getSupabaseClient();
        const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();

        // Get old memories (exclude summaries and preferences)
        const { data: oldMemories, error } = await supabase
            .from('ai_memories')
            .select('*')
            .eq('user_id', userId)
            .lt('created_at', cutoff)
            .not('category', 'in', '("summary","preference")')
            .order('created_at', { ascending: true });

        if (error || !oldMemories || oldMemories.length < 3) {
            return { summarized: 0, created: 0 };
        }

        // Group by category
        const groups: Record<string, AIMemory[]> = {};
        for (const mem of oldMemories as AIMemory[]) {
            const cat = mem.category || 'general';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(mem);
        }

        let summarized = 0;
        let created = 0;

        for (const [category, memories] of Object.entries(groups)) {
            if (memories.length < 2) continue; // Skip if too few to summarize

            // Build summary from memory contents
            const snippets = memories.map(m => m.content.substring(0, 100));
            const summaryContent = `Summary of ${memories.length} ${category} memories: ${snippets.join(' | ')}`;

            // Get IDs of originals
            const originalIds = memories.map(m => m.id);

            // Store summary
            await supabase
                .from('ai_memories')
                .insert({
                    user_id: userId,
                    content: summaryContent.substring(0, 500),
                    category: 'summary',
                    source: 'auto-summarize',
                    importance: 0.8,
                    summary_of: originalIds
                });

            // Delete originals
            await supabase
                .from('ai_memories')
                .delete()
                .in('id', originalIds);

            summarized += memories.length;
            created++;
        }

        console.log(`[MemoryService] Summarized ${summarized} memories into ${created} summaries`);
        return { summarized, created };
    } catch (e: any) {
        console.error('[MemoryService] Summarization failed:', e.message);
        return { summarized: 0, created: 0 };
    }
}

// ═════════════════════════════════════════════════════════════════════
// 5. MEMORY DECAY — reduce unaccessed memory importance
// ═════════════════════════════════════════════════════════════════════

/**
 * Apply decay to old, unaccessed memories:
 * - Reduce importance by 10% for memories not accessed in 14+ days
 * - Delete memories with importance < 0.1 that are 30+ days old
 */
export async function applyMemoryDecay(userId: string): Promise<{ decayed: number; pruned: number }> {
    try {
        const supabase = getSupabaseClient();
        const now = new Date();
        const decayThreshold = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
        const pruneThreshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

        // 1. Decay: reduce importance of old unaccessed memories
        const { data: staleMemories } = await supabase
            .from('ai_memories')
            .select('id, importance')
            .eq('user_id', userId)
            .lt('last_accessed', decayThreshold)
            .not('category', 'eq', 'preference') // Don't decay preferences
            .gt('importance', 0.1);

        let decayed = 0;
        if (staleMemories && staleMemories.length > 0) {
            for (const mem of staleMemories) {
                const newImportance = Math.max(0.05, (mem.importance || 0.5) * 0.9);
                await supabase
                    .from('ai_memories')
                    .update({ importance: newImportance })
                    .eq('id', mem.id);
                decayed++;
            }
        }

        // 2. Prune: delete very old, very low importance memories
        const { data: pruneCandidates } = await supabase
            .from('ai_memories')
            .select('id')
            .eq('user_id', userId)
            .lt('created_at', pruneThreshold)
            .lt('importance', 0.1)
            .not('category', 'in', '("preference","summary")');

        let pruned = 0;
        if (pruneCandidates && pruneCandidates.length > 0) {
            const ids = pruneCandidates.map((m: any) => m.id);
            await supabase
                .from('ai_memories')
                .delete()
                .in('id', ids);
            pruned = ids.length;
        }

        if (decayed > 0 || pruned > 0) {
            console.log(`[MemoryService] Decay: ${decayed} reduced, ${pruned} pruned`);
        }
        return { decayed, pruned };
    } catch (e: any) {
        console.error('[MemoryService] Decay failed:', e.message);
        return { decayed: 0, pruned: 0 };
    }
}

// ═════════════════════════════════════════════════════════════════════
// 6. ENHANCED CONTEXT — topic-aware memory injection
// ═════════════════════════════════════════════════════════════════════

/**
 * Builds rich context by combining:
 * - Smart recall (topic-relevant memories)
 * - User preferences
 * - Session summary from previous session
 */
export async function buildMemoryContext(
    userId: string,
    currentMessage: string = '',
    maxMemories: number = 8
): Promise<string> {
    try {
        const supabase = getSupabaseClient();
        const parts: string[] = [];

        // 1. Smart recall based on current message topic
        if (currentMessage && currentMessage.length > 5) {
            const { memories: relevant } = await smartRecall(userId, currentMessage, 5);
            if (relevant.length > 0) {
                const lines = relevant.map(m => {
                    const timeAgo = getTimeAgo(m.created_at);
                    return `  • [${m.category}] (${timeAgo}) ${m.content.substring(0, 150)}`;
                });
                parts.push(`Relevant memories:\n${lines.join('\n')}`);
            }
        }

        // 2. User preferences (always include if available)
        const { data: preferences } = await supabase
            .from('ai_memories')
            .select('content')
            .eq('user_id', userId)
            .eq('category', 'preference')
            .order('importance', { ascending: false })
            .limit(5);

        if (preferences && preferences.length > 0) {
            const prefLines = preferences.map((p: any) => `  • ${p.content}`);
            parts.push(`User preferences:\n${prefLines.join('\n')}`);
        }

        // 3. Recent session summary
        const session = await loadSession(userId);
        if (session && session.messages.length > 0) {
            const summary = summarizeSession(session.messages);
            if (summary) {
                parts.push(`Previous conversation: ${summary}`);
            }
        }

        if (parts.length === 0) return '';

        return `\n\nMEMORY CONTEXT — Things you remember about this user:\n${parts.join('\n')}`;
    } catch {
        return '';
    }
}

// ═════════════════════════════════════════════════════════════════════
// MAINTENANCE — run on session start
// ═════════════════════════════════════════════════════════════════════

/**
 * Run periodic maintenance: decay + summarization.
 * Safe to call frequently — it's lightweight.
 */
export async function runMemoryMaintenance(userId: string): Promise<void> {
    try {
        await Promise.all([
            applyMemoryDecay(userId),
            summarizeOldMemories(userId, 7)
        ]);
        console.log('[MemoryService] Maintenance complete for', userId);
    } catch (e: any) {
        console.error('[MemoryService] Maintenance failed:', e.message);
    }
}

// ═════════════════════════════════════════════════════════════════════
// CORE FUNCTIONS (kept from original)
// ═════════════════════════════════════════════════════════════════════

export async function storeMemory(
    userId: string,
    content: string,
    category: MemoryCategory = 'general',
    source: string = 'conversation',
    importance: number = 0.5
): Promise<{ success: boolean; memory_id?: string; error?: string }> {
    try {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
            .from('ai_memories')
            .insert({
                user_id: userId,
                content,
                category,
                source,
                importance,
                access_count: 0,
                last_accessed: new Date().toISOString()
            })
            .select('id')
            .single();

        if (error) throw error;
        return { success: true, memory_id: data.id };
    } catch (e: any) {
        console.error('[MemoryService] Store failed:', e.message);
        return { success: false, error: e.message };
    }
}

export async function recallMemories(
    userId: string,
    query: string,
    limit: number = 10
): Promise<{ memories: AIMemory[]; error?: string }> {
    // Delegate to smart recall
    return smartRecall(userId, query, limit);
}

export async function getRecentMemories(
    userId: string,
    limit: number = 10,
    category?: MemoryCategory
): Promise<AIMemory[]> {
    try {
        const supabase = getSupabaseClient();
        let query = supabase
            .from('ai_memories')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (category) {
            query = query.eq('category', category);
        }

        const { data, error } = await query;
        if (error) throw error;
        return (data || []) as AIMemory[];
    } catch (e: any) {
        console.error('[MemoryService] Get recent failed:', e.message);
        return [];
    }
}

export async function storeConversationExchange(
    userId: string,
    userMessage: string,
    aiResponse: string
): Promise<void> {
    const trivialPatterns = /^(hi|hello|hey|thanks|ok|bye|yes|no|sure|good|fine)\.?$/i;
    if (trivialPatterns.test(userMessage.trim())) return;
    if (userMessage.length < 10) return;

    const content = `User asked: "${userMessage.substring(0, 150)}" → AI: "${aiResponse.substring(0, 200)}"`;

    // Store memory + detect preferences in parallel
    await Promise.all([
        storeMemory(userId, content, 'conversation', 'xs-ai-agent', 0.6),
        detectAndStorePreferences(userId, userMessage, aiResponse)
    ]);
}

export async function deleteMemory(memoryId: string): Promise<boolean> {
    try {
        const supabase = getSupabaseClient();
        const { error } = await supabase
            .from('ai_memories')
            .delete()
            .eq('id', memoryId);
        if (error) throw error;
        return true;
    } catch (e: any) {
        console.error('[MemoryService] Delete failed:', e.message);
        return false;
    }
}

export async function clearMemories(userId: string): Promise<boolean> {
    try {
        const supabase = getSupabaseClient();
        const { error } = await supabase
            .from('ai_memories')
            .delete()
            .eq('user_id', userId);
        if (error) throw error;
        return true;
    } catch (e: any) {
        console.error('[MemoryService] Clear failed:', e.message);
        return false;
    }
}

export async function getMemoryStats(userId: string): Promise<MemoryStats> {
    try {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
            .from('ai_memories')
            .select('id, category, importance, access_count, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: true });

        if (error) throw error;

        const memories = data || [];
        const byCategory: Record<string, number> = {};
        let totalAccesses = 0;
        let totalImportance = 0;

        for (const m of memories) {
            byCategory[m.category] = (byCategory[m.category] || 0) + 1;
            totalAccesses += m.access_count || 0;
            totalImportance += m.importance || 0;
        }

        return {
            total: memories.length,
            byCategory,
            oldest: memories.length > 0 ? memories[0].created_at : null,
            newest: memories.length > 0 ? memories[memories.length - 1].created_at : null,
            totalAccesses,
            averageImportance: memories.length > 0 ? totalImportance / memories.length : 0
        };
    } catch (e: any) {
        console.error('[MemoryService] Stats failed:', e.message);
        return { total: 0, byCategory: {}, oldest: null, newest: null, totalAccesses: 0, averageImportance: 0 };
    }
}

export async function checkMemoryHealth(): Promise<{ status: string; latency: number; error?: string }> {
    const start = Date.now();
    try {
        const supabase = getSupabaseClient();
        const { error } = await supabase
            .from('ai_memories')
            .select('id')
            .limit(1);

        const latency = Date.now() - start;
        if (error) throw error;
        return { status: 'healthy', latency };
    } catch (e: any) {
        return { status: 'error', latency: Date.now() - start, error: e.message };
    }
}

// ─── Helpers ────────────────────────────────────────────────────────
function getTimeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}


import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Brain, RefreshCw, Play, Activity, Save, Search, MessageSquare, FileText, Trash2, CheckCircle2, XCircle, Loader2, Send, ChevronRight, Zap, User, Sparkles, Type, BookOpen, Wand2, ChevronDown } from 'lucide-react';
import { getPersona, savePersona, buildSystemPrompt, AIPersona, DEFAULT_PERSONA, ASSISTANTS, AssistantOption } from '../services/personaService';
import { checkMemoryHealth, storeMemory, recallMemories, getMemoryStats } from '../services/memoryService';

interface LogEntry {
    id: string;
    message: string;
    type: 'info' | 'success' | 'error' | 'warning';
    timestamp: string;
}

interface TestResult {
    name: string;
    status: 'pending' | 'running' | 'pass' | 'fail';
    time?: number;
}

const BrainDiagnostics: React.FC = () => {
    // Status
    const [brainStatus, setBrainStatus] = useState<'checking' | 'online' | 'offline'>('checking');
    const [brainEndpoint, setBrainEndpoint] = useState('Checking…');
    const [memoryStatus, setMemoryStatus] = useState<'checking' | 'online' | 'offline'>('checking');
    const [memoryEndpoint, setMemoryEndpoint] = useState('Checking…');

    // Tests
    const [testResults, setTestResults] = useState<TestResult[]>([]);
    const [isRunningAll, setIsRunningAll] = useState(false);
    const [quickTestResult, setQuickTestResult] = useState<{ content: string; header: string } | null>(null);

    // Chat
    const [chatInput, setChatInput] = useState('');
    const [chatResponse, setChatResponse] = useState<string | null>(null);
    const [chatMeta, setChatMeta] = useState<string | null>(null);
    const [isChatLoading, setIsChatLoading] = useState(false);

    // Logs
    const [logs, setLogs] = useState<LogEntry[]>([{ id: '0', message: 'BRAIN diagnostics ready.', type: 'info', timestamp: new Date().toLocaleTimeString() }]);
    const [logsOpen, setLogsOpen] = useState(false);

    const initialized = useRef(false);

    // ─── Persona State ──────────────────────────────────────────────────
    const [selectedAssistant, setSelectedAssistant] = useState<AssistantOption>(ASSISTANTS[0]);
    const [persona, setPersona] = useState<AIPersona>({ ...DEFAULT_PERSONA });
    const [personaLoading, setPersonaLoading] = useState(true);
    const [personaSaving, setPersonaSaving] = useState(false);
    const [personaSaved, setPersonaSaved] = useState(false);
    const [personaError, setPersonaError] = useState<string | null>(null);

    const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
        setLogs(prev => [...prev, {
            id: Date.now().toString() + Math.random(),
            message,
            type,
            timestamp: new Date().toLocaleTimeString()
        }]);
    }, []);

    const clearLogs = () => {
        setLogs([{ id: Date.now().toString(), message: 'Logs cleared', type: 'info', timestamp: new Date().toLocaleTimeString() }]);
    };

    // ─── Diagnostics Init ────────────────────────────────────────────────
    const initDiagnostics = useCallback(async () => {
        addLog('Initializing XS AI Brain diagnostics...', 'info');

        // Check XS AI Brain (Persona + Gemini pipeline)
        try {
            const p = await getPersona();
            if (p && p.name) {
                setBrainStatus('online');
                setBrainEndpoint(`Active — ${p.name}`);
                addLog('XS AI Brain: ONLINE — persona loaded', 'success');
            } else throw new Error('No persona');
        } catch (e: any) {
            setBrainStatus('offline');
            setBrainEndpoint('Not available');
            addLog('XS AI Brain: OFFLINE — ' + e.message, 'error');
        }

        // Check Memory (Supabase)
        try {
            const result = await checkMemoryHealth();
            if (result.status === 'healthy') {
                setMemoryStatus('online');
                setMemoryEndpoint(`Supabase — ${result.latency}ms`);
                addLog('Memory service (Supabase): ONLINE', 'success');
            } else throw new Error(result.error || 'Unhealthy');
        } catch (e: any) {
            setMemoryStatus('offline');
            setMemoryEndpoint('Not available');
            addLog('Memory service: OFFLINE — ' + e.message, 'error');
        }
    }, [addLog]);

    // Auto-init on mount
    React.useEffect(() => {
        if (!initialized.current) {
            initialized.current = true;
            initDiagnostics();
        }
    }, [initDiagnostics]);

    // Load persona when selected assistant changes
    useEffect(() => {
        setPersonaLoading(true);
        setPersonaSaved(false);
        setPersonaError(null);
        (async () => {
            try {
                const p = await getPersona(selectedAssistant.settingsKey);
                setPersona(p);
            } catch (e: any) {
                setPersonaError('Failed to load persona');
            } finally {
                setPersonaLoading(false);
            }
        })();
    }, [selectedAssistant]);

    const handleSavePersona = async () => {
        setPersonaSaving(true);
        setPersonaSaved(false);
        setPersonaError(null);
        try {
            const ok = await savePersona(persona, selectedAssistant.settingsKey);
            if (ok) {
                setPersonaSaved(true);
                addLog(`Persona saved for ${selectedAssistant.label}`, 'success');
                setTimeout(() => setPersonaSaved(false), 3000);
            } else {
                throw new Error('Save returned false');
            }
        } catch (e: any) {
            setPersonaError(e.message);
            addLog('Failed to save persona: ' + e.message, 'error');
        } finally {
            setPersonaSaving(false);
        }
    };

    const handleResetPersona = () => {
        setPersona({ ...selectedAssistant.defaultPersona });
        setPersonaSaved(false);
    };

    // ─── Individual Test Functions ───────────────────────────────────────
    const testHealthCheck = async () => {
        const result = await checkMemoryHealth();
        if (result.status !== 'healthy') throw new Error(result.error || 'Unhealthy');
        return result;
    };

    const testStoreMemory = async () => {
        const result = await storeMemory(
            'xs-crm-diagnostics',
            'Test memory from XS AI Brain diagnostics at ' + new Date().toISOString(),
            'general',
            'brain-diagnostics',
            1.0
        );
        if (!result.success) throw new Error(result.error || 'Store failed');
        return result;
    };

    const testRecallMemory = async () => {
        const result = await recallMemories('xs-crm-diagnostics', 'diagnostics', 5);
        if (result.error) throw new Error(result.error);
        return { memories: result.memories.length, data: result.memories };
    };

    const testLoadPersona = async () => {
        const p = await getPersona();
        if (!p || !p.name) throw new Error('No persona loaded');
        const prompt = buildSystemPrompt(p);
        if (!prompt || prompt.length < 10) throw new Error('System prompt too short');
        return { name: p.name, promptLength: prompt.length };
    };

    const testMemoryStats = async () => {
        const stats = await getMemoryStats('xs-crm-diagnostics');
        return stats;
    };

    // ─── Run All Tests ──────────────────────────────────────────────────
    const runFullBrainTest = async () => {
        setIsRunningAll(true);
        addLog('========== FULL BRAIN TEST ==========', 'info');

        const tests = [
            { name: 'Memory Health Check', fn: testHealthCheck },
            { name: 'Store Memory', fn: testStoreMemory },
            { name: 'Recall Memory', fn: testRecallMemory },
            { name: 'Load AI Persona', fn: testLoadPersona },
            { name: 'Memory Stats', fn: testMemoryStats }
        ];

        const initial: TestResult[] = tests.map(t => ({ name: t.name, status: 'pending' as const }));
        setTestResults(initial);

        let passed = 0, failed = 0;
        const startTime = Date.now();

        for (let i = 0; i < tests.length; i++) {
            setTestResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'running' } : r));
            const testStart = Date.now();

            try {
                await tests[i].fn();
                const elapsed = Date.now() - testStart;
                setTestResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'pass', time: elapsed } : r));
                addLog(`✓ ${tests[i].name}: PASSED (${elapsed}ms)`, 'success');
                passed++;
            } catch (e: any) {
                setTestResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'fail', time: Date.now() - testStart } : r));
                addLog(`✗ ${tests[i].name}: FAILED — ${e.message}`, 'error');
                failed++;
            }
        }

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        addLog(`Tests complete: ${passed} passed, ${failed} failed in ${totalTime}s`, passed === tests.length ? 'success' : 'warning');
        setIsRunningAll(false);
    };

    // ─── Quick Tests ────────────────────────────────────────────────────
    const runQuickTest = async (name: string, fn: () => Promise<any>) => {
        addLog(`Testing ${name}...`, 'info');
        setQuickTestResult({ header: name, content: 'Running...' });
        try {
            const data = await fn();
            setQuickTestResult({ header: name, content: JSON.stringify(data, null, 2) });
            addLog(`${name}: OK`, 'success');
        } catch (e: any) {
            setQuickTestResult({ header: name + ' — ERROR', content: e.message });
            addLog(`${name}: FAILED — ${e.message}`, 'error');
        }
    };

    // ─── Chat with Brain ────────────────────────────────────────────────
    const testBrainChat = async (quickMode = false) => {
        let input = chatInput.trim();
        if (quickMode && !input) {
            input = 'Diagnostic ping — testing persona load and memory recall.';
        }
        if (!input) return;

        addLog('Testing XS AI Brain with: "' + input.substring(0, 50) + '..."', 'info');
        setIsChatLoading(true);
        setChatResponse('Processing...');
        setChatMeta(null);

        const startTime = Date.now();

        try {
            // Test the full XS AI pipeline: persona + memory
            const persona = await getPersona();
            const prompt = buildSystemPrompt(persona);
            const memResult = await recallMemories('xs-crm-test', input, 3);
            const elapsed = Date.now() - startTime;

            const reply = `✅ XS AI Brain is operational.\n\n**Persona:** ${persona.name}\n**System Prompt:** ${prompt.substring(0, 100)}...\n**Memories Found:** ${memResult.memories.length}\n**Pipeline:** Persona → Gemini → Memory`;
            setChatResponse(reply);
            setChatMeta(`Response time: ${elapsed}ms | Persona: ${persona.name}`);
            addLog('XS AI Brain responded in ' + elapsed + 'ms', 'success');
        } catch (e: any) {
            setChatResponse('Error: ' + e.message);
            setChatMeta(null);
            addLog('XS AI Brain test failed: ' + e.message, 'error');
        } finally {
            setIsChatLoading(false);
        }
    };

    // ─── Status Helpers ─────────────────────────────────────────────────
    const statusDot = (status: 'checking' | 'online' | 'offline') => {
        const colors = {
            checking: 'bg-amber-400 animate-pulse',
            online: 'bg-emerald-500',
            offline: 'bg-red-500'
        };
        return <div className={`w-2.5 h-2.5 rounded-full ${colors[status]} shrink-0`} />;
    };

    const logColor = (type: LogEntry['type']) => {
        const colors = { info: 'text-blue-400', success: 'text-emerald-400', error: 'text-red-400', warning: 'text-amber-400' };
        return colors[type];
    };

    // ─────────────────────────────────────────────────────────────────────
    return (
        <div className="max-w-5xl mx-auto pb-24">
            {/* Header */}
            <div className="mb-6 flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-r from-violet-600 to-indigo-600 rounded-xl text-white"><Brain size={24} /></div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Brain Diagnostics</h1>
                        <p className="text-slate-500 text-sm mt-1">Monitor HALL Brain and Memory services, run diagnostics, and test connections.</p>
                    </div>
                </div>
                <button
                    onClick={initDiagnostics}
                    className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-violet-600 hover:border-violet-300 transition-all"
                    title="Re-check services"
                >
                    <RefreshCw size={18} />
                </button>
            </div>

            {/* ═══ Persona Configuration ═══ */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
                <div className="p-4 border-b border-slate-100 bg-gradient-to-r from-violet-50 to-indigo-50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <Wand2 className="text-violet-500" size={18} />
                            AI Persona Configuration
                        </h3>
                        <div className="relative">
                            <select
                                value={selectedAssistant.id}
                                onChange={e => {
                                    const found = ASSISTANTS.find(a => a.id === e.target.value);
                                    if (found) setSelectedAssistant(found);
                                }}
                                className="appearance-none bg-white border border-slate-200 rounded-lg pl-3 pr-8 py-1.5 text-xs font-semibold text-slate-700 cursor-pointer hover:border-violet-300 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition-all"
                            >
                                {ASSISTANTS.map(a => (
                                    <option key={a.id} value={a.id}>{a.label}</option>
                                ))}
                            </select>
                            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {personaSaved && (
                            <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full flex items-center gap-1">
                                <CheckCircle2 size={12} /> Saved
                            </span>
                        )}
                        {personaError && (
                            <span className="text-xs font-semibold text-red-600 bg-red-50 px-3 py-1 rounded-full flex items-center gap-1">
                                <XCircle size={12} /> {personaError}
                            </span>
                        )}
                        <button
                            onClick={handleResetPersona}
                            className="text-xs font-semibold text-slate-400 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors"
                        >
                            Reset to Default
                        </button>
                        <button
                            onClick={handleSavePersona}
                            disabled={personaSaving}
                            className="inline-flex items-center gap-1.5 px-5 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg font-semibold text-xs shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all disabled:opacity-60"
                        >
                            {personaSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                            {personaSaving ? 'Saving...' : 'Save Persona'}
                        </button>
                    </div>
                </div>

                {personaLoading ? (
                    <div className="p-8 flex items-center justify-center gap-2 text-slate-400">
                        <Loader2 size={18} className="animate-spin" /> Loading persona...
                    </div>
                ) : (
                    <div className="p-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                            {/* Name */}
                            <div>
                                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                    <User size={12} /> Assistant Name
                                </label>
                                <input
                                    type="text"
                                    value={persona.name}
                                    onChange={e => setPersona(p => ({ ...p, name: e.target.value }))}
                                    placeholder="XS Agent"
                                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition-all"
                                />
                            </div>

                            {/* Personality */}
                            <div>
                                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                    <Sparkles size={12} /> Personality
                                </label>
                                <input
                                    type="text"
                                    value={persona.personality}
                                    onChange={e => setPersona(p => ({ ...p, personality: e.target.value }))}
                                    placeholder="Professional, concise, direct"
                                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition-all"
                                />
                            </div>

                            {/* Tone */}
                            <div>
                                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                    <MessageSquare size={12} /> Tone
                                </label>
                                <input
                                    type="text"
                                    value={persona.tone}
                                    onChange={e => setPersona(p => ({ ...p, tone: e.target.value }))}
                                    placeholder="Executive-level, no emojis, start with the answer"
                                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition-all"
                                />
                            </div>

                            {/* Expertise */}
                            <div>
                                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                    <BookOpen size={12} /> Expertise
                                </label>
                                <input
                                    type="text"
                                    value={persona.expertise}
                                    onChange={e => setPersona(p => ({ ...p, expertise: e.target.value }))}
                                    placeholder="Business management, logistics, international trade"
                                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition-all"
                                />
                            </div>

                            {/* Response Style */}
                            <div className="lg:col-span-2">
                                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                    <Type size={12} /> Response Style
                                </label>
                                <input
                                    type="text"
                                    value={persona.responseStyle}
                                    onChange={e => setPersona(p => ({ ...p, responseStyle: e.target.value }))}
                                    placeholder="Maximum 2 sentences. Start with the answer."
                                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition-all"
                                />
                            </div>

                            {/* Custom Instructions */}
                            <div className="lg:col-span-2">
                                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                    <Brain size={12} /> Custom Instructions
                                </label>
                                <textarea
                                    value={persona.customInstructions}
                                    onChange={e => setPersona(p => ({ ...p, customInstructions: e.target.value }))}
                                    placeholder="Any additional instructions for the AI assistant (optional)..."
                                    rows={3}
                                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition-all resize-none"
                                />
                            </div>
                        </div>

                        {/* Preview */}
                        <div className="mt-5 bg-slate-900 rounded-xl p-4">
                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">System Prompt Preview</div>
                            <pre className="text-xs text-emerald-400 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-32 overflow-y-auto">
                                {`You are ${persona.name}, an executive AI for a business management and logistics platform. ${persona.tone}. ${persona.responseStyle} Personality: ${persona.personality}. Expertise: ${persona.expertise}.${persona.customInstructions ? ' ' + persona.customInstructions : ''}`}
                            </pre>
                        </div>
                    </div>
                )}
            </div>

            {/* Status Bar */}
            <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex items-center gap-3">
                    {statusDot(brainStatus)}
                    <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-slate-700 uppercase tracking-wide">XS AI Brain</div>
                        <div className="text-xs text-slate-400 truncate mt-0.5">{brainEndpoint}</div>
                    </div>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex items-center gap-3">
                    {statusDot(memoryStatus)}
                    <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-slate-700 uppercase tracking-wide">XS Memory</div>
                        <div className="text-xs text-slate-400 truncate mt-0.5">{memoryEndpoint}</div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Run All Tests */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-fit">
                    <div className="p-4 border-b border-slate-100 bg-slate-50">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <CheckCircle2 className="text-violet-500" size={18} />
                            System Tests
                        </h3>
                    </div>
                    <div className="p-6">
                        <div className="text-center mb-4">
                            <button
                                onClick={runFullBrainTest}
                                disabled={isRunningAll}
                                className="inline-flex items-center gap-2.5 px-8 py-3.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.97]"
                            >
                                {isRunningAll ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
                                {isRunningAll ? 'Running Tests...' : 'Run All Tests'}
                            </button>
                        </div>

                        {testResults.length > 0 && (
                            <div className="bg-slate-900 rounded-xl p-4 space-y-2">
                                {testResults.map((t, i) => (
                                    <div key={i} className="flex items-center gap-3 bg-slate-800/60 rounded-lg px-3 py-2.5 text-sm">
                                        {t.status === 'pending' && <div className="w-5 h-5 rounded-full bg-slate-600 flex items-center justify-center text-[10px] text-slate-400">•</div>}
                                        {t.status === 'running' && <Loader2 size={18} className="text-amber-400 animate-spin shrink-0" />}
                                        {t.status === 'pass' && <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />}
                                        {t.status === 'fail' && <XCircle size={18} className="text-red-400 shrink-0" />}
                                        <span className="text-white flex-1">{t.name}</span>
                                        <span className="text-slate-500 text-xs">
                                            {t.status === 'running' ? 'running' : t.status === 'pass' ? `${t.time}ms` : t.status === 'fail' ? 'FAILED' : ''}
                                        </span>
                                    </div>
                                ))}
                                {!isRunningAll && testResults.length > 0 && (
                                    <div className="border-t border-slate-700 pt-3 mt-2 flex justify-between text-sm font-semibold">
                                        <span className="text-emerald-400">{testResults.filter(t => t.status === 'pass').length} passed</span>
                                        <span className="text-red-400">{testResults.filter(t => t.status === 'fail').length} failed</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Quick Tests */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-fit">
                    <div className="p-4 border-b border-slate-100 bg-slate-50">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <Zap className="text-amber-500" size={18} />
                            Quick Tests
                        </h3>
                    </div>
                    <div className="p-6">
                        <div className="grid grid-cols-4 gap-3 mb-4">
                            <button onClick={() => runQuickTest('Health', testHealthCheck)} className="flex flex-col items-center gap-1.5 p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:border-violet-400 hover:text-violet-600 transition-all hover:-translate-y-0.5 active:scale-95">
                                <Activity size={18} className="text-slate-400" />
                                Health
                            </button>
                            <button onClick={() => runQuickTest('Store', testStoreMemory)} className="flex flex-col items-center gap-1.5 p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:border-violet-400 hover:text-violet-600 transition-all hover:-translate-y-0.5 active:scale-95">
                                <Save size={18} className="text-slate-400" />
                                Store
                            </button>
                            <button onClick={() => runQuickTest('Recall', testRecallMemory)} className="flex flex-col items-center gap-1.5 p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:border-violet-400 hover:text-violet-600 transition-all hover:-translate-y-0.5 active:scale-95">
                                <Search size={18} className="text-slate-400" />
                                Recall
                            </button>
                            <button onClick={() => testBrainChat(true)} className="flex flex-col items-center gap-1.5 p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:border-violet-400 hover:text-violet-600 transition-all hover:-translate-y-0.5 active:scale-95">
                                <Brain size={18} className="text-slate-400" />
                                Brain
                            </button>
                        </div>

                        {quickTestResult && (
                            <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">{quickTestResult.header}</div>
                                <pre className="text-xs text-slate-700 whitespace-pre-wrap break-words max-h-40 overflow-y-auto font-mono leading-relaxed">{quickTestResult.content}</pre>
                            </div>
                        )}
                    </div>
                </div>

                {/* Chat with Brain */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-fit lg:col-span-2">
                    <div className="p-4 border-b border-slate-100 bg-slate-50">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <MessageSquare className="text-blue-500" size={18} />
                            Chat with Brain
                        </h3>
                    </div>
                    <div className="p-6">
                        <div className="flex gap-2 mb-4">
                            <input
                                type="text"
                                value={chatInput}
                                onChange={e => setChatInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && testBrainChat()}
                                placeholder="Ask HALL Brain something…"
                                className="flex-1 border border-slate-300 rounded-xl px-4 py-3 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition-all"
                            />
                            <button
                                onClick={() => testBrainChat()}
                                disabled={isChatLoading}
                                className="w-12 h-12 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white flex items-center justify-center hover:-translate-y-0.5 hover:shadow-lg transition-all shrink-0 disabled:opacity-60 active:scale-95"
                            >
                                {isChatLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                            </button>
                        </div>

                        {chatResponse && (
                            <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
                                <pre className="text-sm text-slate-700 whitespace-pre-wrap break-words max-h-48 overflow-y-auto leading-relaxed">{chatResponse}</pre>
                                {chatMeta && (
                                    <div className="mt-3 text-xs text-slate-400 border-t border-slate-200 pt-2">{chatMeta}</div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Connection Logs */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-fit lg:col-span-2">
                    <button
                        onClick={() => setLogsOpen(!logsOpen)}
                        className="w-full p-4 flex items-center gap-2 text-left hover:bg-slate-50 transition-colors"
                    >
                        <ChevronRight size={14} className={`text-slate-400 transition-transform ${logsOpen ? 'rotate-90' : ''}`} />
                        <FileText size={16} className="text-slate-400" />
                        <span className="text-sm font-semibold text-slate-600 flex-1">Connection Logs</span>
                        <span
                            onClick={(e) => { e.stopPropagation(); clearLogs(); }}
                            className="text-[11px] font-semibold text-slate-400 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-md cursor-pointer transition-colors"
                        >
                            Clear
                        </span>
                    </button>

                    {logsOpen && (
                        <div className="bg-slate-900 rounded-b-xl max-h-48 overflow-y-auto p-4 font-mono text-xs space-y-1">
                            {logs.map(log => (
                                <div key={log.id} className={logColor(log.type)}>
                                    <span className="text-slate-600">[{log.timestamp}]</span> {log.message}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BrainDiagnostics;

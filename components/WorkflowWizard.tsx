/**
 * WorkflowWizard — Multi-step chained workflow execution in XS Agent chat
 *
 * Renders an inline wizard card that walks the user through a predefined
 * multi-step workflow (e.g., "Onboard Customer" → create → quote → proforma → SO).
 * Each step can trigger AI commands or present forms.
 */

import React, { useState, useCallback } from 'react';
import { CheckCircle2, Circle, ArrowRight, Play, SkipForward, X, ChevronDown, ChevronUp, Loader2, Workflow } from 'lucide-react';
import { WorkflowTemplate, WorkflowStep, WORKFLOW_TEMPLATES } from '../services/smartInsightsEngine';

interface WorkflowWizardProps {
  onExecuteStep?: (command: string, stepId: string) => void;
  onClose?: () => void;
  className?: string;
}

// ── Workflow Picker ────────────────────────────────────────────────────

const WorkflowPicker: React.FC<{ onSelect: (wf: WorkflowTemplate) => void }> = ({ onSelect }) => {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Workflow size={14} className="text-indigo-500" />
        <span className="text-xs font-bold text-slate-700">Start a Workflow</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {WORKFLOW_TEMPLATES.map(wf => (
          <button
            key={wf.id}
            onClick={() => onSelect(wf)}
            className="group text-left bg-gradient-to-br from-white to-indigo-50/50 border border-indigo-100 hover:border-indigo-300 rounded-xl p-3 transition-all hover:shadow-md"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xl">{wf.icon}</span>
              <span className="text-[10px] text-slate-400 font-medium">{wf.estimatedTime}</span>
            </div>
            <div className="text-xs font-bold text-slate-800">{wf.name}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{wf.description}</div>
            <div className="mt-2 flex items-center gap-1">
              {wf.steps.map((_, i) => (
                <div key={i} className="w-2 h-2 rounded-full bg-indigo-200 group-hover:bg-indigo-300 transition-colors" />
              ))}
              <span className="text-[9px] text-slate-400 ml-1">{wf.steps.length} steps</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

// ── Active Workflow Card ───────────────────────────────────────────────

const ActiveWorkflow: React.FC<{
  workflow: WorkflowTemplate;
  steps: WorkflowStep[];
  currentStepIndex: number;
  onExecute: (step: WorkflowStep) => void;
  onSkip: (step: WorkflowStep) => void;
  onCancel: () => void;
}> = ({ workflow, steps, currentStepIndex, onExecute, onSkip, onCancel }) => {
  const completedCount = steps.filter(s => s.status === 'completed').length;
  const progress = (completedCount / steps.length) * 100;
  const isComplete = completedCount === steps.length;

  return (
    <div className="bg-gradient-to-br from-white to-indigo-50/30 border border-indigo-100 rounded-2xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{workflow.icon}</span>
          <div>
            <div className="text-white font-bold text-xs">{workflow.name}</div>
            <div className="text-indigo-200 text-[10px]">
              {isComplete ? 'Completed!' : `Step ${currentStepIndex + 1} of ${steps.length}`}
            </div>
          </div>
        </div>
        <button
          onClick={onCancel}
          className="p-1 hover:bg-white/10 rounded-lg text-indigo-200 hover:text-white transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Progress Bar */}
      <div className="h-1 bg-indigo-100">
        <div
          className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Steps */}
      <div className="p-3 space-y-1.5">
        {steps.map((step, i) => {
          const isCurrent = i === currentStepIndex && !isComplete;
          const isCompleted = step.status === 'completed';
          const isSkipped = step.status === 'skipped';

          return (
            <div
              key={step.id}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all ${
                isCurrent
                  ? 'bg-indigo-50 border border-indigo-200 shadow-sm'
                  : isCompleted
                  ? 'bg-emerald-50/50'
                  : isSkipped
                  ? 'bg-slate-50 opacity-50'
                  : 'opacity-60'
              }`}
            >
              {/* Step Icon */}
              <div className="shrink-0">
                {isCompleted ? (
                  <CheckCircle2 size={18} className="text-emerald-500" />
                ) : isCurrent ? (
                  <div className="w-[18px] h-[18px] rounded-full border-2 border-indigo-500 bg-indigo-100 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                  </div>
                ) : isSkipped ? (
                  <SkipForward size={18} className="text-slate-400" />
                ) : (
                  <Circle size={18} className="text-slate-300" />
                )}
              </div>

              {/* Step Info */}
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-semibold ${isCurrent ? 'text-indigo-700' : isCompleted ? 'text-emerald-700' : 'text-slate-500'}`}>
                  {step.label}
                </div>
                <div className="text-[10px] text-slate-400">{step.description}</div>
              </div>

              {/* Actions */}
              {isCurrent && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => onSkip(step)}
                    className="text-[10px] text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => onExecute(step)}
                    className="flex items-center gap-1 text-[10px] font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg transition-colors shadow-sm"
                  >
                    <Play size={10} />
                    Go
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Complete State */}
      {isComplete && (
        <div className="px-4 pb-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
            <CheckCircle2 size={20} className="text-emerald-500 mx-auto mb-1" />
            <div className="text-xs font-bold text-emerald-700">Workflow Complete</div>
            <div className="text-[10px] text-emerald-600 mt-0.5">All steps finished successfully</div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main WorkflowWizard ───────────────────────────────────────────────

const WorkflowWizard: React.FC<WorkflowWizardProps> = ({ onExecuteStep, onClose, className = '' }) => {
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowTemplate | null>(null);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const handleSelectWorkflow = useCallback((wf: WorkflowTemplate) => {
    setActiveWorkflow(wf);
    setSteps(wf.steps.map(s => ({ ...s, status: 'pending' as const })));
    setCurrentStepIndex(0);
  }, []);

  const handleExecuteStep = useCallback((step: WorkflowStep) => {
    // Mark current step as completed
    setSteps(prev => prev.map((s, i) =>
      i === currentStepIndex ? { ...s, status: 'completed' as const } : s
    ));
    setCurrentStepIndex(prev => prev + 1);

    // Trigger the AI command
    onExecuteStep?.(step.actionCommand, step.id);
  }, [currentStepIndex, onExecuteStep]);

  const handleSkipStep = useCallback((step: WorkflowStep) => {
    setSteps(prev => prev.map((s, i) =>
      i === currentStepIndex ? { ...s, status: 'skipped' as const } : s
    ));
    setCurrentStepIndex(prev => prev + 1);
  }, [currentStepIndex]);

  const handleCancel = useCallback(() => {
    setActiveWorkflow(null);
    setSteps([]);
    setCurrentStepIndex(0);
    onClose?.();
  }, [onClose]);

  return (
    <div className={className}>
      {activeWorkflow ? (
        <ActiveWorkflow
          workflow={activeWorkflow}
          steps={steps}
          currentStepIndex={currentStepIndex}
          onExecute={handleExecuteStep}
          onSkip={handleSkipStep}
          onCancel={handleCancel}
        />
      ) : (
        <WorkflowPicker onSelect={handleSelectWorkflow} />
      )}
    </div>
  );
};

export default WorkflowWizard;

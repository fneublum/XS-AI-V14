
import React from 'react';
import { Activity, Building2 } from 'lucide-react';
import { User, Company } from '../types';
import AiDashboard from './AiDashboard';

interface DashboardProps {
    currentUser: User;
    currentCompanyId: string;
    availableCompanies: Company[];
    // All other data props removed — AiDashboard is now a chat-only WhatsApp interface
    [key: string]: any; // Accept any extra props gracefully (from App.tsx)
}

// Basic Error Boundary Component
interface ErrorBoundaryProps {
    children: React.ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = {
        hasError: false
    };

    static getDerivedStateFromError(error: any) {
        return { hasError: true };
    }

    componentDidCatch(error: any, errorInfo: any) {
        console.error("Dashboard Error:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center text-slate-500">
                    <div className="bg-red-50 p-4 rounded-full mb-4">
                        <Activity className="text-red-500" size={32} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 mb-2">Dashboard Component Error</h3>
                    <p className="text-sm max-w-md">The Intelligence Interface encountered an unexpected issue. Please refresh the page or contact support.</p>
                </div>
            );
        }

        return this.props.children;
    }
}

const Dashboard: React.FC<DashboardProps> = ({
    currentUser,
    currentCompanyId,
    availableCompanies = [],
    ...rest
}) => {
    const currentCompanyName = (currentCompanyId === 'ALL' || !availableCompanies)
        ? 'Global View'
        : availableCompanies.find(c => c.id === currentCompanyId)?.name || 'Company Dashboard';

    const userName = currentUser?.name ? currentUser.name.split(' ')[0] : 'User';

    return (
        <div className="h-full overflow-hidden custom-scrollbar animate-in fade-in duration-500 flex flex-col">

            {/* Minimal Header */}
            <div className="shrink-0 flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                    <h1 className="text-xl font-bold text-slate-800">Hello, {userName}</h1>
                    <span className="text-slate-400">•</span>
                    <div className="flex items-center gap-2 text-slate-500 text-sm">
                        <Building2 size={14} />
                        <span>{currentCompanyName}</span>
                    </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
                </div>
            </div>

            {/* Full-screen HALL Chat */}
            <div className="flex-1 min-h-0 overflow-hidden">
                <ErrorBoundary>
                    <AiDashboard currentUser={currentUser} />
                </ErrorBoundary>
            </div>
        </div>
    );
};

export default Dashboard;

import React, { useState, useEffect, useRef } from 'react';
import { FreightQuote, Port, Supplier, Company, CargoAgent, Carrier, SavedLocation, User, Role } from '../types';
import { Ship, Plus, X, Save, Trash2, MapPin, Anchor, ArrowRight, Pencil, AlertCircle, Truck, LayoutGrid, List, CheckCircle2, Loader2, Clock, CalendarClock, Package, Container, Building, DollarSign, Filter, Search, ChevronDown, FilePlus } from 'lucide-react';
import { FormattedInput, PriceInput } from '../components/UnitInputs';
import { lookupLocation } from '../services/geminiService';

interface FreightQuotesProps {
    quotes: FreightQuote[];
    onAdd: (q: FreightQuote) => void;
    onUpdate: (q: FreightQuote) => void;
    onDelete: (id: string) => void;
    ports: Port[];
    onAddPort: (p: Port) => void;

    // New Props for Agents/Carriers
    cargoAgents: CargoAgent[];
    onAddAgent: (a: CargoAgent) => void;
    carriers: Carrier[];
    onAddCarrier: (c: Carrier) => void;

    // Locations
    locations: SavedLocation[];
    onAddLocation: (l: SavedLocation) => void;

    dbError?: string | null;
    currentCompanyId: string;
    availableCompanies: Company[];
    currentUser?: User; // Optional prop to handle access control
}

// Helper to extract unique values for filtering
const getUniqueValues = (data: any[], key: string) => {
    const values = data.map(item => item[key]).filter(v => v !== undefined && v !== null && v !== '');
    return Array.from(new Set(values)).sort();
};

// Helper to format address: Remove street part if present (heuristic: starts with number)
const formatAddress = (address?: string) => {
    if (!address) return '';
    const parts = address.split(',').map(p => p.trim());
    // If >1 part and first part starts with digit, assume street address and strip it
    if (parts.length > 1 && /^\d/.test(parts[0])) {
        return parts.slice(1).join(', ');
    }
    return address;
};

const getStatusStyling = (status?: 'PENDING' | 'ACTIVE' | 'EXPIRED') => {
    switch (status) {
        case 'ACTIVE':
            return 'bg-emerald-100 text-emerald-700 border-emerald-200';
        case 'PENDING':
            return 'bg-amber-100 text-amber-700 border-amber-200';
        case 'EXPIRED':
            return 'bg-slate-100 text-slate-600 border-slate-200';
        default:
            return 'bg-slate-100 text-slate-600 border-slate-200';
    }
};

const FreightQuotes: React.FC<FreightQuotesProps> = ({
    quotes, onAdd, onUpdate, onDelete,
    ports, onAddPort,
    cargoAgents, onAddAgent,
    carriers, onAddCarrier,
    locations, onAddLocation,
    dbError, currentCompanyId, availableCompanies,
    currentUser
}) => {
    // --- ROLE BASED ACCESS LOGIC ---
    const isCargoAgentUser = currentUser?.role === Role.CARGO_AGENT;
    const linkedAgentName = isCargoAgentUser
        ? cargoAgents.find(a => a.id === currentUser?.linked_entity_id)?.name || ''
        : '';

    // Filter quotes: if Cargo Agent, only show their own quotes. Otherwise show all.
    // Filter quotes: if Cargo Agent, only show their own quotes. Otherwise show all.
    // Use quotes passed from parent (already filtered)

    // NORMALIZE DATA: Handle potential snake_case from DB
    const normalizeQuote = (q: any): FreightQuote => ({
        ...q,
        freightType: q.freightType || q.freight_type || 'PORT_PORT',
        agentName: q.agentName || q.agent_name || '',
        companyId: q.companyId || q.company_id || '',
        originPort: q.originPort || q.origin_port || '',
        originPortCode: q.originPortCode || q.origin_port_code || '',
        destinationPort: q.destinationPort || q.destination_port || '',
        destinationPortCode: q.destinationPortCode || q.destination_port_code || '',
        pickupLocation: q.pickupLocation || q.pickup_location || '',
        pickupZip: q.pickupZip || q.pickup_zip || '',
        deliveryLocation: q.deliveryLocation || q.delivery_location || '',
        deliveryZip: q.deliveryZip || q.delivery_zip || '',
        validUntil: q.validUntil || q.valid_until || '',
        transitTime: q.transitTime || q.transit_time,
        freeTime: q.freeTime || q.free_time,
        isAllIn: q.isAllIn !== undefined ? q.isAllIn : q.is_all_in,
        pickupCost: q.pickupCost || q.pickup_cost,
        oceanCost: q.oceanCost || q.ocean_cost,
        deliveryCost: q.deliveryCost || q.delivery_cost,
        portFees: q.portFees || q.port_fees,
        containerCount: q.containerCount || q.container_count,
        containerReturn: q.containerReturn || q.container_return,
        blRelease: q.blRelease || q.bl_release,
        securityFee: q.securityFee || q.security_fee,
        rate: q.rate !== undefined ? q.rate : 0
    });

    // Filter quotes: if Cargo Agent, only show quotes matching their linked agent name
    const visibleQuotes = quotes.map(normalizeQuote).filter(q => {
        if (!isCargoAgentUser) return true; // Non-agents see all quotes
        if (!linkedAgentName) return true; // No linked agent = show all (fallback)

        // Match quote's agentName against the linked agent name (case-insensitive)
        const quoteAgent = (q.agentName || '').toUpperCase();
        const targetAgent = linkedAgentName.toUpperCase();

        // Flexible match: quote agent contains target agent name OR vice versa
        return quoteAgent.includes(targetAgent) || targetAgent.includes(quoteAgent);
    });

    // Determine selectable companies for the dropdown
    const selectableCompanies = isCargoAgentUser
        ? availableCompanies.filter(c =>
            !currentUser?.allowed_company_ids?.length ||
            currentUser.allowed_company_ids.includes(c.id)
        )
        : availableCompanies;

    // --------------------------------

    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'table'>('table');
    const [isLocationLoading, setIsLocationLoading] = useState(false);
    const [useAllIn, setUseAllIn] = useState(true);
    const [formError, setFormError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    // Filtering State
    const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null);
    const [filters, setFilters] = useState<Record<string, string[]>>({});
    const [filterSearch, setFilterSearch] = useState('');
    const filterMenuRef = useRef<HTMLDivElement>(null);

    // Quick Add Port State
    const [showQuickAddPort, setShowQuickAddPort] = useState(false);
    const [newPortCode, setNewPortCode] = useState('');
    const [newPortName, setNewPortName] = useState('');
    const [newPortCountry, setNewPortCountry] = useState('');
    const [portAddedMessage, setPortAddedMessage] = useState('');
    const [targetPortField, setTargetPortField] = useState<'origin' | 'destination' | null>(null);

    // Quick Add Supplier/Carrier State
    const [showQuickAddEntity, setShowQuickAddEntity] = useState(false);
    const [newEntityName, setNewEntityName] = useState('');
    const [newEntityAddedMessage, setNewEntityAddedMessage] = useState('');
    const [targetEntityField, setTargetEntityField] = useState<'agent' | 'carrier' | null>(null);

    // Quick Add Location State
    const [showQuickAddLocation, setShowQuickAddLocation] = useState(false);
    const [newLocName, setNewLocName] = useState('');
    const [newLocAddress, setNewLocAddress] = useState('');
    const [newLocCity, setNewLocCity] = useState('');
    const [newLocState, setNewLocState] = useState('');
    const [newLocZip, setNewLocZip] = useState('');
    const [targetLocationField, setTargetLocationField] = useState<'pickup' | 'delivery' | null>(null);
    const [locationAddedMessage, setLocationAddedMessage] = useState('');

    // Column Widths
    const [colWidths, setColWidths] = useState({
        service: 140,
        status: 110,
        agent: 180,
        pickup: 220,
        origin: 110,
        poaName: 180, // New Column
        dest: 110,
        pooName: 180, // New Column
        delivery: 220,
        rate: 130,
        time: 120,
        validity: 130,
        carrier: 160,
        actions: 100
    });

    useEffect(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Set to start of day for comparison

        const expiredQuotes = quotes.map(normalizeQuote).filter(q => {
            if (q.status !== 'ACTIVE' && q.status !== 'PENDING') return false;
            if (!q.validUntil) return false;
            // Dates are YYYY-MM-DD. Parsing them this way avoids timezone issues.
            try {
                const parts = q.validUntil.split('-');
                if (parts.length !== 3) return false;
                const validUntilDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                return validUntilDate < today;
            } catch (e) {
                return false;
            }
        });

        if (expiredQuotes.length > 0) {
            expiredQuotes.forEach(quote => {
                onUpdate({ ...quote, status: 'EXPIRED' });
            });
        }
    }, [quotes, onUpdate]);

    // Handle click outside for filter menu
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
                setActiveFilterColumn(null);
                setFilterSearch('');
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const startResize = (e: React.MouseEvent, colKey: keyof typeof colWidths) => {
        e.preventDefault();
        const startX = e.pageX;
        const startWidth = colWidths[colKey];

        const onMouseMove = (moveEvent: MouseEvent) => {
            const newWidth = Math.max(10, startWidth + (moveEvent.pageX - startX));
            setColWidths(prev => ({ ...prev, [colKey]: newWidth }));
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    const initialFormState: Partial<FreightQuote> = {
        agentName: isCargoAgentUser ? linkedAgentName : '', // Pre-fill for Cargo Agent
        carrier: '',
        freightType: 'PORT_PORT',
        originPort: '',
        originPortCode: '',
        pickupLocation: '',
        pickupZip: '',
        destinationPort: '',
        destinationPortCode: '',
        deliveryLocation: '',
        deliveryZip: '',
        rate: 0,
        chassis: 0,
        overweight: 0,
        containerCount: 1,
        currency: 'USD',
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        comments: '',
        companyId: currentCompanyId === 'ALL' ? '' : currentCompanyId,
        transitTime: 0,
        freeTime: 0,
        isAllIn: true,
        pickupCost: 0,
        oceanCost: 0,
        deliveryCost: 0,
        portFees: 0,
        deconsolidation: 0,
        containerReturn: 0,
        blRelease: 0,
        thc: 0,
        isps: 0,
        trs: 0,
        securityFee: 0,
        observation: '',
        status: 'PENDING'
    };

    const [formData, setFormData] = useState<Partial<FreightQuote>>(initialFormState);

    // DEBUG: Log data flow
    console.log('[FreightQuotes] Input quotes:', quotes.length, 'visibleQuotes:', visibleQuotes.length);

    // Apply Filters
    const filteredQuotes = visibleQuotes.filter(quote => {
        // Global Search
        const searchLower = searchTerm.toLowerCase();
        const matchesGlobal = searchTerm === '' ||
            (quote.agentName && quote.agentName.toLowerCase().includes(searchLower)) ||
            (quote.carrier && quote.carrier.toLowerCase().includes(searchLower)) ||
            (quote.originPortCode && quote.originPortCode.toLowerCase().includes(searchLower)) ||
            (quote.destinationPortCode && quote.destinationPortCode.toLowerCase().includes(searchLower)) ||
            (quote.pickupLocation && quote.pickupLocation.toLowerCase().includes(searchLower)) ||
            (quote.deliveryLocation && quote.deliveryLocation.toLowerCase().includes(searchLower)) ||
            (quote.status && quote.status.toLowerCase().includes(searchLower));

        if (!matchesGlobal) return false;

        // Column Filters
        for (const [key, selectedValues] of Object.entries(filters)) {
            const values = selectedValues as string[];
            if (values.length > 0) {
                const cellValue = String(quote[key as keyof FreightQuote] || '');
                if (!values.includes(cellValue)) return false;
            }
        }
        return true;
    });

    const toggleFilter = (column: string, value: string) => {
        setFilters(prev => {
            const current = prev[column] || [];
            if (current.includes(value)) {
                const updated = current.filter(v => v !== value);
                return updated.length === 0 ? { ...prev, [column]: [] } : { ...prev, [column]: updated };
            } else {
                return { ...prev, [column]: [...current, value] };
            }
        });
    };

    const clearColumnFilter = (column: string) => {
        setFilters(prev => {
            const next = { ...prev };
            delete next[column];
            return next;
        });
    };

    const handleAddNew = () => {
        setFormData({
            ...initialFormState,
            companyId: (currentCompanyId === 'ALL' || isCargoAgentUser) ? (formData.companyId || '') : currentCompanyId,
            agentName: isCargoAgentUser ? linkedAgentName : '' // Ensure logic persists on new
        });
        setUseAllIn(true);
        setEditingId(null);
        setFormError(null);
        setIsAdding(true);
    };

    const handleEdit = (quote: FreightQuote, e: React.MouseEvent) => {
        e.stopPropagation();
        setFormData(quote);
        setUseAllIn(quote.isAllIn !== false); // Default to true if undefined
        setEditingId(quote.id);
        setFormError(null);
        setIsAdding(true);
    };

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (window.confirm('Delete this freight quote?')) {
            onDelete(id);
        }
    };

    const handleLocationLookup = async (context: 'pickup' | 'delivery', lookupBy: 'city' | 'zip') => {
        const currentCity = context === 'pickup' ? formData.pickupLocation : formData.deliveryLocation;
        const currentZip = context === 'pickup' ? formData.pickupZip : formData.deliveryZip;

        const query = lookupBy === 'city' ? currentCity : currentZip;
        if (!query || query.length < (lookupBy === 'city' ? 3 : 5)) return;

        setIsLocationLoading(true);
        const result = await lookupLocation(query, lookupBy);
        setIsLocationLoading(false);

        if (result) {
            setFormData(prev => ({
                ...prev,
                [context === 'pickup' ? 'pickupZip' : 'deliveryZip']: result.zip,
                [context === 'pickup' ? 'pickupLocation' : 'deliveryLocation']: `${result.city}, ${result.state}`
            }));
        }
    };

    const handleQuickAddPort = async () => {
        if (!newPortCode || !newPortName) return;
        const newPort: Port = {
            id: `PRT${Date.now()}`,
            companyId: 'ALL',
            code: newPortCode.toUpperCase(),
            name: newPortName,
            country: newPortCountry
        };
        await onAddPort(newPort);

        if (targetPortField === 'origin') {
            setFormData(prev => ({
                ...prev,
                originPort: newPort.name,
                originPortCode: newPort.code
            }));
        } else if (targetPortField === 'destination') {
            setFormData(prev => ({
                ...prev,
                destinationPort: newPort.name,
                destinationPortCode: newPort.code
            }));
        }

        setNewPortCode(''); setNewPortName(''); setNewPortCountry('');
        setShowQuickAddPort(false);
        setPortAddedMessage('Port added!');
        setTimeout(() => setPortAddedMessage(''), 3000);
    };

    const handleQuickAddEntity = async () => {
        if (!newEntityName.trim()) return;

        const companyIdForNewRecord = formData.companyId || (currentCompanyId === 'ALL' ? '' : currentCompanyId);
        if (!companyIdForNewRecord) {
            alert("Please select a company context first.");
            return;
        }

        if (targetEntityField === 'agent') {
            const newAgent: CargoAgent = {
                id: `AGT${Date.now()}`,
                companyId: companyIdForNewRecord,
                name: newEntityName.trim(),
                email: '', phone: '', country: ''
            };
            await onAddAgent(newAgent);
            setFormData(prev => ({ ...prev, agentName: newAgent.name }));
        } else if (targetEntityField === 'carrier') {
            const newCarrier: Carrier = {
                id: `CRR${Date.now()}`,
                companyId: companyIdForNewRecord,
                name: newEntityName.trim(),
                scac: '', country: ''
            };
            await onAddCarrier(newCarrier);
            setFormData(prev => ({ ...prev, carrier: newCarrier.name }));
        }

        setNewEntityName('');
        setShowQuickAddEntity(false);
        setNewEntityAddedMessage('Added!');
        setTimeout(() => setNewEntityAddedMessage(''), 3000);
    };

    const handleQuickAddLocation = async () => {
        if (!newLocName) return;
        const companyIdForNewRecord = formData.companyId || (currentCompanyId === 'ALL' ? '' : currentCompanyId);

        const newLocation: SavedLocation = {
            id: `LOC${Date.now()}`,
            companyId: companyIdForNewRecord || 'ALL',
            code: `LOC-${Math.floor(Math.random() * 1000)}`,
            name: newLocName,
            address: newLocAddress,
            city: newLocCity,
            state: newLocState,
            zip: newLocZip,
            country: 'USA',
            entityType: 'WAREHOUSE',
            entityId: '',
            entityName: ''
        };

        await onAddLocation(newLocation);

        const addressString = `${newLocation.address ? newLocation.address + ', ' : ''}${newLocation.city}, ${newLocation.state}`;
        if (targetLocationField === 'pickup') {
            setFormData(prev => ({ ...prev, pickupLocation: addressString, pickupZip: newLocation.zip }));
        } else if (targetLocationField === 'delivery') {
            setFormData(prev => ({ ...prev, deliveryLocation: addressString, deliveryZip: newLocation.zip }));
        }

        setShowQuickAddLocation(false);
        setNewLocName(''); setNewLocAddress(''); setNewLocCity(''); setNewLocState(''); setNewLocZip('');
        setLocationAddedMessage('Location saved & applied!');
        setTimeout(() => setLocationAddedMessage(''), 3000);
    };

    const handleLocationSelect = (e: React.ChangeEvent<HTMLSelectElement>, type: 'pickup' | 'delivery') => {
        const val = e.target.value;
        if (val === '_ADD_NEW_') {
            setTargetLocationField(type);
            setShowQuickAddLocation(true);
            return;
        }

        const loc = locations.find(l => l.id === val);
        if (loc) {
            // Construct address string
            let addr = loc.address || '';
            if (loc.city && loc.state) {
                addr = addr ? `${addr}, ${loc.city}, ${loc.state}` : `${loc.city}, ${loc.state}`;
            }
            // Fallback if empty
            if (!addr) addr = loc.name;

            if (type === 'pickup') {
                setFormData(prev => ({ ...prev, pickupLocation: addr, pickupZip: loc.zip }));
            } else {
                setFormData(prev => ({ ...prev, deliveryLocation: addr, deliveryZip: loc.zip }));
            }
        }
    };

    const handlePortSelect = (e: React.ChangeEvent<HTMLSelectElement>, type: 'origin' | 'destination') => {
        const val = e.target.value;
        if (val === '_ADD_NEW_') {
            setTargetPortField(type);
            setShowQuickAddPort(true);
            return;
        }
        const port = ports.find(p => p.id === val);
        if (port) {
            if (type === 'origin') {
                setFormData(prev => ({ ...prev, originPort: port.name, originPortCode: port.code }));
            } else {
                setFormData(prev => ({ ...prev, destinationPort: port.name, destinationPortCode: port.code }));
            }
        }
    };

    const handleEntitySelect = (e: React.ChangeEvent<HTMLSelectElement>, type: 'agent' | 'carrier') => {
        const val = e.target.value;
        if (val === '_ADD_NEW_') {
            setTargetEntityField(type);
            setShowQuickAddEntity(true);
            return;
        }
        if (type === 'agent') {
            setFormData(prev => ({ ...prev, agentName: val }));
        } else {
            setFormData(prev => ({ ...prev, carrier: val }));
        }
    };

    const handleComponentChange = (field: string, val: number) => {
        setFormData(prev => {
            const newData = { ...prev, [field]: val };
            if (!useAllIn) {
                newData.rate = (newData.pickupCost || 0) + (newData.oceanCost || 0) + (newData.deliveryCost || 0) + (newData.portFees || 0) +
                    (newData.deconsolidation || 0) + (newData.containerReturn || 0) + (newData.blRelease || 0) +
                    (newData.thc || 0) + (newData.isps || 0) + (newData.trs || 0) + (newData.securityFee || 0);
            }
            return newData;
        });
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setFormError(null);

        const companyIdForNewRecord = formData.companyId || ((currentCompanyId === 'ALL' || isCargoAgentUser) ? '' : currentCompanyId);

        if (!companyIdForNewRecord) {
            setFormError("Please select a 'Assign to Company' value.");
            return;
        }

        const finalAgentName = isCargoAgentUser ? linkedAgentName : (formData.agentName || '');
        if (!finalAgentName) {
            setFormError("Cargo Agent is required.");
            return;
        }

        let finalRate = formData.rate || 0;
        if (!useAllIn) {
            finalRate = (formData.pickupCost || 0) + (formData.oceanCost || 0) + (formData.deliveryCost || 0) + (formData.portFees || 0) +
                (formData.deconsolidation || 0) + (formData.containerReturn || 0) + (formData.blRelease || 0) +
                (formData.thc || 0) + (formData.isps || 0) + (formData.trs || 0) + (formData.securityFee || 0);
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const parts = formData.validUntil!.split('-');
        const validUntilDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        const isExpired = validUntilDate < today;

        const status = (finalRate > 0 && !isExpired) ? 'ACTIVE' : (finalRate > 0 && isExpired) ? 'EXPIRED' : 'PENDING';

        const quoteData: FreightQuote = {
            id: editingId || `FQ${Date.now()}`,
            companyId: companyIdForNewRecord,
            agentName: finalAgentName,
            carrier: formData.carrier || '',
            freightType: formData.freightType || 'PORT_PORT',
            originPort: formData.originPort || '',
            originPortCode: formData.originPortCode || '',
            pickupLocation: formData.pickupLocation || '',
            pickupZip: formData.pickupZip || '',
            destinationPort: formData.destinationPort || '',
            destinationPortCode: formData.destinationPortCode || '',
            deliveryLocation: formData.deliveryLocation || '',
            deliveryZip: formData.deliveryZip || '',
            rate: finalRate,
            chassis: formData.chassis || 0,
            overweight: formData.overweight || 0,
            containerCount: formData.containerCount || 1,
            currency: formData.currency || 'USD',
            validUntil: formData.validUntil!,
            comments: formData.comments || '',
            transitTime: formData.transitTime || 0,
            freeTime: formData.freeTime || 0,
            isAllIn: useAllIn,
            pickupCost: useAllIn ? 0 : (formData.pickupCost || 0),
            oceanCost: useAllIn ? 0 : (formData.oceanCost || 0),
            deliveryCost: useAllIn ? 0 : (formData.deliveryCost || 0),
            portFees: useAllIn ? 0 : (formData.portFees || 0),
            deconsolidation: formData.deconsolidation || 0,
            containerReturn: formData.containerReturn || 0,
            blRelease: formData.blRelease || 0,
            thc: formData.thc || 0,
            isps: formData.isps || 0,
            trs: formData.trs || 0,
            securityFee: formData.securityFee || 0,
            observation: formData.observation || '',
            status: status
        };

        // Prepare for DB (snake_case as expected by actual Supabase schema)
        // The schema.ts shows quoted camelCase, but actual DB uses snake_case
        const safeDbRecord = {
            id: quoteData.id,
            company_id: quoteData.companyId,
            agent_name: quoteData.agentName,
            carrier: quoteData.carrier,
            freight_type: quoteData.freightType,

            origin_port: quoteData.originPort,
            origin_port_code: quoteData.originPortCode,

            destination_port: quoteData.destinationPort,
            destination_port_code: quoteData.destinationPortCode,

            pickup_location: quoteData.pickupLocation,
            pickup_zip: quoteData.pickupZip,

            delivery_location: quoteData.deliveryLocation,
            delivery_zip: quoteData.deliveryZip,

            rate: quoteData.rate,
            chassis: quoteData.chassis,
            overweight: quoteData.overweight,
            container_count: quoteData.containerCount,
            currency: quoteData.currency,

            valid_until: quoteData.validUntil,
            comments: quoteData.comments,

            transit_time: quoteData.transitTime,
            free_time: quoteData.freeTime,
            is_all_in: quoteData.isAllIn,

            pickup_cost: quoteData.pickupCost,
            ocean_cost: quoteData.oceanCost,
            delivery_cost: quoteData.deliveryCost,
            port_fees: quoteData.portFees,

            deconsolidation: quoteData.deconsolidation,
            container_return: quoteData.containerReturn,
            bl_release: quoteData.blRelease,
            thc: quoteData.thc,
            isps: quoteData.isps,
            trs: quoteData.trs,
            security_fee: quoteData.securityFee,
            observation: quoteData.observation,

            status: quoteData.status
        };

        // HACK: We pass 'any' to bypass TS check since onAdd expects FreightQuote
        // We separate ID from the payload for the update to ensure we don't try to update the PK column itself, 
        // essentially providing a clean "SET" payload.
        if (editingId) {
            const { id, ...updatePayload } = safeDbRecord;
            // We must pass an object that matches the shape expected by useSupabase's updateRecord
            // which uses .eq('id', record.id). So we actually DO need the ID in the object passed to the hook.
            // But valid Supabase update shouldn't fail on ID if it matches. 
            // The 400 is almost certainly missing columns.
            onUpdate(safeDbRecord as any);
        }
        else onAdd(safeDbRecord as any);

        setIsAdding(false);
        setFormData(initialFormState);
    };

    // Helper to find Port ID from Code to bind Select value
    const getPortId = (code?: string) => {
        if (!code) return '';
        const port = ports.find(p => p.code === code);
        return port ? port.id : '';
    };

    const getTypeLabel = (type?: string) => {
        switch (type) {
            case 'PORT_PORT': return 'Port to Port';
            case 'PORT_DOOR': return 'Port to Door';
            case 'DOOR_PORT': return 'Door to Port';
            case 'DOOR_DOOR': return 'Door to Door';
            default: return 'Port to Port';
        }
    };

    const renderColumnHeader = (id: keyof FreightQuote | null, label: string, widthKey: keyof typeof colWidths, align: 'left' | 'right' | 'center' = 'left') => {
        const uniqueValues = id ? getUniqueValues(visibleQuotes, id as string) : [];
        const activeValues = id ? (filters[id as string] || []) : [];
        const isFilterActive = activeValues.length > 0;

        return (
            <th
                className="px-4 py-3 bg-slate-50 border-b border-r border-slate-200 text-xs font-bold text-slate-600 uppercase tracking-wider relative group select-none"
                style={{ width: colWidths[widthKey], minWidth: colWidths[widthKey] }}
            >
                <div className={`flex items-center gap-2 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-between'}`}>
                    <span>{label}</span>
                    {id && (
                        <button
                            onClick={(e) => { e.stopPropagation(); setActiveFilterColumn(activeFilterColumn === id ? null : id as string); setFilterSearch(''); }}
                            className={`p-1 rounded hover:bg-slate-200 transition-colors ${isFilterActive ? 'text-blue-600 bg-blue-50' : 'text-slate-400 opacity-0 group-hover:opacity-100'}`}
                        >
                            <Filter size={14} fill={isFilterActive ? "currentColor" : "none"} />
                        </button>
                    )}
                </div>

                {/* Filter Dropdown */}
                {id && activeFilterColumn === id && (
                    <div ref={filterMenuRef} className="absolute top-full right-0 mt-1 w-64 bg-white rounded-lg shadow-xl border border-slate-200 z-50 overflow-hidden animate-in fade-in zoom-in-95 text-left font-sans normal-case">
                        <div className="p-2 border-b border-slate-100">
                            <div className="relative">
                                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    className="w-full pl-8 pr-2 py-1.5 text-xs border border-slate-200 rounded bg-slate-50 outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder="Search..."
                                    value={filterSearch}
                                    onChange={e => setFilterSearch(e.target.value)}
                                    autoFocus
                                />
                            </div>
                        </div>
                        <div className="max-h-48 overflow-y-auto p-1 custom-scrollbar">
                            <button
                                onClick={() => clearColumnFilter(id as string)}
                                className="w-full text-left px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded flex items-center gap-2"
                            >
                                <X size={12} /> Clear Filter
                            </button>
                            {uniqueValues.filter(v => String(v).toLowerCase().includes(filterSearch.toLowerCase())).map(val => (
                                <button
                                    key={String(val)}
                                    onClick={() => toggleFilter(id as string, String(val))}
                                    className="w-full text-left px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded flex items-center gap-2"
                                >
                                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${activeValues.includes(String(val)) ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'}`}>
                                        {activeValues.includes(String(val)) && <CheckCircle2 size={10} className="text-white" />}
                                    </div>
                                    <span className="truncate">{String(val)}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Resize Handle */}
                <div
                    onMouseDown={(e) => startResize(e, widthKey)}
                    className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10"
                />
            </th>
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <Ship className="text-blue-600" /> Freight Quotes
                    </h2>
                    <p className="text-slate-500 text-sm">
                        {isCargoAgentUser
                            ? `Managing Quotes for: ${linkedAgentName}`
                            : "Manage logistics cost estimates from cargo agents."}
                    </p>
                </div>
                <div className="flex gap-2">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="text"
                            placeholder="Global Search..."
                            className="pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="bg-white border border-slate-200 rounded-lg p-1 flex gap-1">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={`p-2 rounded transition-all ${viewMode === 'grid' ? 'bg-slate-100 text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            title="Grid View"
                        >
                            <LayoutGrid size={18} />
                        </button>
                        <button
                            onClick={() => setViewMode('table')}
                            className={`p-2 rounded transition-all ${viewMode === 'table' ? 'bg-slate-100 text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            title="Table View"
                        >
                            <List size={18} />
                        </button>
                    </div>
                    <button onClick={handleAddNew} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 shadow-sm">
                        <Plus size={18} /> Add Quote
                    </button>
                </div>
            </div>

            {dbError && (
                <div className="bg-red-50 text-red-600 p-4 rounded-xl flex items-start gap-3 border border-red-100 animate-in fade-in">
                    <AlertCircle size={20} className="mt-0.5 shrink-0" />
                    <div><p className="font-bold text-sm">Database Error</p><p className="text-xs mt-1 opacity-90">{dbError}</p></div>
                </div>
            )}


            {/* Main Content Area */}
            {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredQuotes.map(quote => (
                        <div key={quote.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow group relative">
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
                                        <Ship size={24} />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-slate-800 text-lg">{quote.agentName}</h4>
                                        <p className="text-sm text-slate-500 font-medium">Carrier: {quote.carrier}</p>
                                    </div>
                                </div>
                                <div className="text-right flex flex-col items-end">
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded mb-1 border ${getStatusStyling(quote.status)}`}>
                                        {quote.status}
                                    </span>
                                    <p className="text-2xl font-bold text-emerald-600">${quote.rate.toLocaleString()}</p>
                                    {quote.isAllIn === false && <span className="text-[10px] bg-slate-100 text-slate-500 px-1 rounded">Split Cost</span>}
                                </div>
                            </div>

                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 relative overflow-hidden">
                                {/* Type Badge */}
                                <div className="absolute top-0 right-0 bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 font-bold rounded-bl-lg border-l border-b border-blue-200">
                                    {getTypeLabel(quote.freightType)}
                                </div>

                                <div className="flex items-center justify-between mt-2">
                                    <div className="flex-1 text-center">
                                        <span className="block text-lg font-bold text-slate-700">{quote.originPortCode || 'POA'}</span>
                                        <span className="text-xs text-slate-500">{quote.originPort}</span>
                                        {quote.pickupLocation && (
                                            <p className="text-[10px] text-slate-400 mt-1 truncate max-w-[150px] mx-auto bg-white px-1 rounded border border-slate-200">
                                                <span className="font-bold">PU:</span> {formatAddress(quote.pickupLocation)}
                                            </p>
                                        )}
                                    </div>
                                    <div className="px-4 text-slate-300"><ArrowRight size={20} /></div>
                                    <div className="flex-1 text-center">
                                        <span className="block text-lg font-bold text-slate-700">{quote.destinationPortCode || 'POD'}</span>
                                        <span className="text-xs text-slate-500">{quote.destinationPort}</span>
                                        {quote.deliveryLocation && (
                                            <p className="text-[10px] text-slate-400 mt-1 truncate max-w-[150px] mx-auto bg-white px-1 rounded border border-slate-200">
                                                <span className="font-bold">DEL:</span> {formatAddress(quote.deliveryLocation)}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="mt-3 flex justify-between items-center px-1">
                                <div className="flex gap-3 text-xs text-slate-500">
                                    {quote.transitTime ? <span className="flex items-center gap-1" title="Transit Time"><Clock size={12} /> {quote.transitTime} days</span> : null}
                                    {quote.freeTime ? <span className="flex items-center gap-1" title="Free Time"><CalendarClock size={12} /> {quote.freeTime} days FT</span> : null}
                                </div>
                                <div className="flex gap-2">
                                    {quote.chassis && quote.chassis > 0 && <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200">Chassis: ${quote.chassis}</span>}
                                    {quote.overweight && quote.overweight > 0 && <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200">Over: ${quote.overweight}</span>}
                                </div>
                            </div>

                            <div className="flex justify-between items-center mt-4 text-xs text-slate-500 border-t border-slate-100 pt-3">
                                <span>Valid Until: {quote.validUntil}</span>
                                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={(e) => handleEdit(quote, e)} className="text-slate-400 hover:text-amber-500"><Pencil size={16} /></button>
                                    <button onClick={(e) => handleDelete(quote.id, e)} className="text-slate-400 hover:text-red-500"><Trash2 size={16} /></button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                // --- EXCEL-LIKE TABLE VIEW ---
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-full max-h-[calc(100vh-16rem)]">
                    <div className="overflow-auto custom-scrollbar flex-1">
                        <table className="w-full text-left border-collapse table-fixed">
                            <thead className="bg-slate-50 sticky top-0 z-20 shadow-sm">
                                <tr>
                                    {renderColumnHeader('freightType', 'Service', 'service')}
                                    {renderColumnHeader('status', 'Status', 'status')}
                                    {renderColumnHeader('agentName', 'Agent', 'agent')}
                                    {renderColumnHeader('pickupLocation', 'Pick Up', 'pickup')}
                                    {renderColumnHeader('originPortCode', 'POA', 'origin')}
                                    {renderColumnHeader('originPort', 'POA NAME', 'poaName')}
                                    {renderColumnHeader('destinationPortCode', 'POD', 'dest')}
                                    {renderColumnHeader('destinationPort', 'POD NAME', 'pooName')}
                                    {renderColumnHeader('deliveryLocation', 'Delivery', 'delivery')}
                                    {renderColumnHeader(null, 'Rate ($)', 'rate', 'right')}
                                    {renderColumnHeader(null, 'TT / FT', 'time', 'right')}
                                    {renderColumnHeader(null, 'Validity', 'validity')}
                                    {renderColumnHeader('carrier', 'Carrier', 'carrier')}
                                    {renderColumnHeader(null, 'Actions', 'actions', 'right')}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredQuotes.map(quote => (
                                    <tr key={quote.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-xs whitespace-nowrap">
                                            <span className="font-bold bg-blue-50 text-blue-700 px-1 py-0 rounded border border-blue-100 text-[10px]">
                                                {getTypeLabel(quote.freightType)}
                                            </span>
                                        </td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-xs whitespace-nowrap">
                                            <span className={`font-bold px-1 py-0 rounded border text-[10px] ${getStatusStyling(quote.status)}`}>
                                                {quote.status || 'PENDING'}
                                            </span>
                                        </td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-xs font-medium text-slate-800 whitespace-nowrap truncate max-w-[150px]" title={quote.agentName}>
                                            {quote.agentName}
                                        </td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-xs text-slate-600 whitespace-nowrap">
                                            {(!quote.pickupLocation && !quote.pickupZip) ? (
                                                <span className="text-slate-400 italic text-[10px]">NA</span>
                                            ) : (
                                                <div className="flex items-center gap-1 truncate max-w-[180px]" title={quote.pickupLocation}>
                                                    <span className="truncate">{formatAddress(quote.pickupLocation)}</span>
                                                    {quote.pickupZip && <span className="text-[10px] text-slate-400 shrink-0">({quote.pickupZip})</span>}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-xs font-mono text-slate-700 whitespace-nowrap" title={quote.originPort}>{quote.originPortCode || '-'}</td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-xs text-slate-600 whitespace-nowrap truncate max-w-[180px]" title={quote.originPort}>
                                            {quote.originPort || '-'}
                                        </td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-xs font-mono text-slate-700 whitespace-nowrap" title={quote.destinationPort}>{quote.destinationPortCode || '-'}</td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-xs text-slate-600 whitespace-nowrap truncate max-w-[180px]" title={quote.destinationPort}>
                                            {quote.destinationPort || '-'}
                                        </td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-xs text-slate-600 whitespace-nowrap">
                                            {(!quote.deliveryLocation && !quote.deliveryZip) ? (
                                                <span className="text-slate-400 italic text-[10px]">NA</span>
                                            ) : (
                                                <div className="flex items-center gap-1 truncate max-w-[180px]" title={quote.deliveryLocation}>
                                                    <span className="truncate">{formatAddress(quote.deliveryLocation)}</span>
                                                    {quote.deliveryZip && <span className="text-[10px] text-slate-400 shrink-0">({quote.deliveryZip})</span>}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-right whitespace-nowrap">
                                            <span className="font-bold text-emerald-600 text-xs">${quote.rate.toLocaleString()}</span>
                                            {quote.isAllIn === false && <span className="text-[9px] text-slate-400 ml-1">Split</span>}
                                        </td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-right text-[10px] text-slate-600 whitespace-nowrap">
                                            {quote.transitTime ? `${quote.transitTime}d` : '-'} / {quote.freeTime ? `${quote.freeTime}d` : '-'}
                                        </td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-[10px] text-slate-500 whitespace-nowrap">
                                            {quote.validUntil}
                                        </td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-xs text-slate-600 whitespace-nowrap truncate max-w-[120px]" title={quote.carrier}>{quote.carrier}</td>
                                        <td className="px-2 py-0.5 text-right whitespace-nowrap">
                                            <div className="flex items-center justify-end gap-1">
                                                <button onClick={(e) => handleEdit(quote, e)} className="text-slate-400 hover:text-amber-500 p-0.5"><Pencil size={12} /></button>
                                                <button onClick={(e) => handleDelete(quote.id, e)} className="text-slate-400 hover:text-red-500 p-0.5"><Trash2 size={12} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {filteredQuotes.length === 0 && (
                                    <tr>
                                        <td colSpan={12} className="px-6 py-12 text-center text-slate-400">
                                            No quotes found matching filters.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="bg-slate-50 border-t border-slate-200 p-2 text-xs text-slate-500 flex justify-between">
                        <span>Showing {filteredQuotes.length} quotes</span>
                        <span>Use column headers to filter</span>
                    </div>
                </div>
            )}

            {filteredQuotes.length === 0 && !isAdding && viewMode === 'grid' && (
                <div className="text-center py-12 text-slate-400 bg-white rounded-xl border border-dashed border-slate-200">
                    <Ship size={48} className="mx-auto mb-4 opacity-20" />
                    <p>No freight quotes available.</p>
                </div>
            )}

            {isAdding && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-in zoom-in-95">
                        {/* Header */}
                        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50">
                            <h3 className="font-bold text-slate-800 text-xl flex items-center gap-2">
                                {editingId ? <Pencil size={20} className="text-blue-600" /> : <Plus size={20} className="text-blue-600" />}
                                {editingId ? 'Edit Freight Quote' : 'New Freight Quote'}
                            </h3>
                            <button onClick={() => setIsAdding(false)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
                        </div>

                        {/* Form Body */}
                        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                            {formError && (
                                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2 border border-red-100">
                                    <AlertCircle size={16} /> {formError}
                                </div>
                            )}

                            {/* Company & Agent */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {(currentCompanyId === 'ALL' || isCargoAgentUser) && (
                                    <div>
                                        <label className="block text-xs font-bold text-blue-800 uppercase mb-1">Assign to Company</label>
                                        <select
                                            required
                                            value={formData.companyId}
                                            onChange={e => setFormData({ ...formData, companyId: e.target.value })}
                                            className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                                        >
                                            <option value="">Select Company...</option>
                                            {selectableCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    </div>
                                )}

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cargo Agent</label>
                                    {isCargoAgentUser ? (
                                        <input className="w-full border border-slate-200 bg-slate-100 rounded-lg p-2 text-sm text-slate-500 cursor-not-allowed" value={linkedAgentName} readOnly />
                                    ) : (
                                        <select
                                            required
                                            value={formData.agentName}
                                            onChange={e => handleEntitySelect(e, 'agent')}
                                            className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                                        >
                                            <option value="">Select Agent...</option>
                                            <option value="_ADD_NEW_" className="font-bold text-blue-600">+ Add New Agent</option>
                                            {cargoAgents.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                                        </select>
                                    )}
                                </div>
                            </div>

                            {/* Service Type & Carrier */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Service Type</label>
                                    <select
                                        className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                                        value={formData.freightType}
                                        onChange={e => setFormData({ ...formData, freightType: e.target.value as any })}
                                    >
                                        <option value="PORT_PORT">Port to Port</option>
                                        <option value="PORT_DOOR">Port to Door</option>
                                        <option value="DOOR_PORT">Door to Port</option>
                                        <option value="DOOR_DOOR">Door to Door</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Carrier</label>
                                    <select
                                        className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                                        value={formData.carrier}
                                        onChange={e => handleEntitySelect(e, 'carrier')}
                                    >
                                        <option value="">Select Carrier...</option>
                                        <option value="_ADD_NEW_" className="font-bold text-blue-600">+ Add New Carrier</option>
                                        {carriers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            {/* Route: Origin / Dest / Pickup / Delivery based on Type */}
                            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
                                <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1"><MapPin size={12} /> Route Details</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {(formData.freightType === 'DOOR_PORT' || formData.freightType === 'DOOR_DOOR') && (
                                        <div className="col-span-2 md:col-span-1 relative">
                                            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Pick Up</label>
                                            <div className="flex gap-1">
                                                <select className="w-8 border border-slate-300 rounded-l-lg bg-white p-1 text-xs" onChange={e => handleLocationSelect(e, 'pickup')}><option value="">Select</option><option value="_ADD_NEW_">+</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
                                                <input className="flex-1 border border-slate-300 rounded-r-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="City or Zip" value={formData.pickupLocation} onChange={e => setFormData({ ...formData, pickupLocation: e.target.value })} onBlur={() => handleLocationLookup('pickup', 'city')} />
                                            </div>
                                            {isLocationLoading && <Loader2 size={12} className="absolute right-2 top-8 animate-spin text-slate-400" />}
                                        </div>
                                    )}

                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Port of Loading (Origin)</label>
                                        <select
                                            className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                            value={getPortId(formData.originPortCode)}
                                            onChange={e => handlePortSelect(e, 'origin')}
                                        >
                                            <option value="">Select Port...</option>
                                            <option value="_ADD_NEW_" className="font-bold text-blue-600">+ Add Port</option>
                                            {ports.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Port of Discharge (Dest)</label>
                                        <select
                                            className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                            value={getPortId(formData.destinationPortCode)}
                                            onChange={e => handlePortSelect(e, 'destination')}
                                        >
                                            <option value="">Select Port...</option>
                                            <option value="_ADD_NEW_" className="font-bold text-blue-600">+ Add Port</option>
                                            {ports.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                                        </select>
                                    </div>

                                    {(formData.freightType === 'PORT_DOOR' || formData.freightType === 'DOOR_DOOR') && (
                                        <div className="col-span-2 md:col-span-1 relative">
                                            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Delivery Location</label>
                                            <div className="flex gap-1">
                                                <select className="w-8 border border-slate-300 rounded-l-lg bg-white p-1 text-xs" onChange={e => handleLocationSelect(e, 'delivery')}><option value="">Select</option><option value="_ADD_NEW_">+</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
                                                <input className="flex-1 border border-slate-300 rounded-r-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="City or Zip" value={formData.deliveryLocation} onChange={e => setFormData({ ...formData, deliveryLocation: e.target.value })} onBlur={() => handleLocationLookup('delivery', 'city')} />
                                            </div>
                                            {isLocationLoading && <Loader2 size={12} className="absolute right-2 top-8 animate-spin text-slate-400" />}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Pricing */}
                            <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl space-y-4">
                                <div className="flex justify-between items-center">
                                    <h4 className="text-xs font-bold text-emerald-700 uppercase flex items-center gap-1"><DollarSign size={12} /> Pricing & Costs</h4>
                                    <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                                        <input type="checkbox" checked={useAllIn} onChange={e => setUseAllIn(e.target.checked)} className="rounded text-emerald-600 focus:ring-emerald-500" />
                                        <span className="font-bold text-slate-700">All-In Rate</span>
                                    </label>
                                </div>

                                {useAllIn ? (
                                    <div>
                                        <label className="block text-xs font-bold text-emerald-800 uppercase mb-1">Total Rate</label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                                            <input
                                                type="number"
                                                className="w-full pl-8 border border-emerald-200 rounded-lg p-2 text-lg font-bold text-emerald-700 focus:ring-2 focus:ring-emerald-500 outline-none"
                                                placeholder="0.00"
                                                value={formData.rate}
                                                onChange={e => handleComponentChange('rate', parseFloat(e.target.value))}
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-4">
                                        <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Pickup Cost</label><FormattedInput value={formData.pickupCost || 0} onChange={v => handleComponentChange('pickupCost', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                        <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Ocean Freight</label><FormattedInput value={formData.oceanCost || 0} onChange={v => handleComponentChange('oceanCost', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                        <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Delivery Cost</label><FormattedInput value={formData.deliveryCost || 0} onChange={v => handleComponentChange('deliveryCost', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                        <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Port/Doc Fees</label><FormattedInput value={formData.portFees || 0} onChange={v => handleComponentChange('portFees', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                        <div className="col-span-2 pt-2 border-t border-emerald-200 flex justify-between items-center text-sm font-bold text-emerald-800">
                                            <span>Total Calculated Rate:</span>
                                            <span>${formData.rate?.toLocaleString()}</span>
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-3 gap-4 pt-2 border-t border-emerald-200">
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Currency</label><select className="w-full border border-slate-300 rounded p-1.5 text-sm bg-white" value={formData.currency} onChange={e => setFormData({ ...formData, currency: e.target.value })}><option>USD</option><option>EUR</option><option>CNY</option></select></div>
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Valid Until</label><input type="date" className="w-full border border-slate-300 rounded p-1.5 text-sm" value={formData.validUntil} onChange={e => setFormData({ ...formData, validUntil: e.target.value })} /></div>
                                </div>

                                {/* Extra Charges / Fees */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t border-emerald-200">
                                    <div className="col-span-full pb-1"><h5 className="text-[10px] font-bold text-emerald-700 uppercase">Additional Fees</h5></div>
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase">THC</label><FormattedInput value={formData.thc || 0} onChange={v => handleComponentChange('thc', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase">ISPS</label><FormattedInput value={formData.isps || 0} onChange={v => handleComponentChange('isps', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase">B/L Release</label><FormattedInput value={formData.blRelease || 0} onChange={v => handleComponentChange('blRelease', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Container Return</label><FormattedInput value={formData.containerReturn || 0} onChange={v => handleComponentChange('containerReturn', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Deconsolidation</label><FormattedInput value={formData.deconsolidation || 0} onChange={v => handleComponentChange('deconsolidation', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase">TRS</label><FormattedInput value={formData.trs || 0} onChange={v => handleComponentChange('trs', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Security Fee</label><FormattedInput value={formData.securityFee || 0} onChange={v => handleComponentChange('securityFee', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                </div>
                            </div>

                            {/* Details */}
                            <div className="grid grid-cols-4 gap-4">
                                <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Transit Time (Days)</label><input type="number" className="w-full border border-slate-300 rounded p-2 text-sm" value={formData.transitTime} onChange={e => setFormData({ ...formData, transitTime: parseFloat(e.target.value) || 0 })} /></div>
                                <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Free Time (Days)</label><input type="number" className="w-full border border-slate-300 rounded p-2 text-sm" value={formData.freeTime} onChange={e => setFormData({ ...formData, freeTime: parseFloat(e.target.value) || 0 })} /></div>
                                <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Chassis ($)</label><input type="number" className="w-full border border-slate-300 rounded p-2 text-sm" value={formData.chassis} onChange={e => setFormData({ ...formData, chassis: parseFloat(e.target.value) || 0 })} /></div>
                                <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Overweight ($)</label><input type="number" className="w-full border border-slate-300 rounded p-2 text-sm" value={formData.overweight} onChange={e => setFormData({ ...formData, overweight: parseFloat(e.target.value) || 0 })} /></div>
                            </div>

                            {/* Observation / Comments */}
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Observation</label>
                                <textarea
                                    className="w-full border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    rows={2}
                                    placeholder="Any observations..."
                                    value={formData.observation}
                                    onChange={e => setFormData({ ...formData, observation: e.target.value })}
                                />
                            </div>

                            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2">
                                <Save size={18} /> {editingId ? 'Update Quote' : 'Save Quote'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Quick Add Port */}
            {showQuickAddPort && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl max-sm w-full overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50"><h3 className="font-bold text-slate-800 flex items-center gap-2"><Anchor size={20} /> Quick Add Port</h3><button onClick={() => setShowQuickAddPort(false)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button></div>
                        <div className="p-6 space-y-4">
                            <div><input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm uppercase font-mono mb-2" placeholder="Code (3-5 Letters)" maxLength={5} value={newPortCode} onChange={e => setNewPortCode(e.target.value.toUpperCase())} autoFocus /></div>
                            <div><input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm mb-2" placeholder="Port Name" value={newPortName} onChange={e => setNewPortName(e.target.value)} /></div>
                            <div><input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="Country" value={newPortCountry} onChange={e => setNewPortCountry(e.target.value)} /></div>
                            <button onClick={handleQuickAddPort} disabled={!newPortCode || !newPortName} className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">Add & Select Port</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Quick Add Entity */}
            {showQuickAddEntity && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50"><h3 className="font-bold text-slate-800 flex items-center gap-2"><Truck size={20} /> New Partner</h3><button onClick={() => setShowQuickAddEntity(false)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button></div>
                        <div className="p-6 space-y-4">
                            <input className="w-full border border-slate-300 rounded-lg p-2 text-sm" placeholder="Company Name" value={newEntityName} onChange={e => setNewEntityName(e.target.value)} autoFocus />
                            <button onClick={handleQuickAddEntity} disabled={!newEntityName} className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">Add & Select</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Quick Add Location */}
            {showQuickAddLocation && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-lg border border-slate-200 w-80 space-y-3 p-6">
                        <div className="flex justify-between items-center mb-2"><h4 className="font-bold text-lg flex items-center gap-2"><MapPin size={20} /> New Location</h4><button onClick={() => setShowQuickAddLocation(false)}><X size={18} className="text-slate-400" /></button></div>
                        <input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="Location Name" value={newLocName} onChange={e => setNewLocName(e.target.value)} />
                        <input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="Address" value={newLocAddress} onChange={e => setNewLocAddress(e.target.value)} />
                        <div className="grid grid-cols-2 gap-2">
                            <input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="City" value={newLocCity} onChange={e => setNewLocCity(e.target.value)} />
                            <input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="State" value={newLocState} onChange={e => setNewLocState(e.target.value)} />
                        </div>
                        <input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="Zip Code" value={newLocZip} onChange={e => setNewLocZip(e.target.value)} />
                        <button onClick={handleQuickAddLocation} disabled={!newLocName} className="w-full bg-blue-600 text-white font-bold py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 mt-2">Save Location</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FreightQuotes;

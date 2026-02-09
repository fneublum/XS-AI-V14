
import React, { useState, useEffect, useRef } from 'react';

// Conversion Factors
const KG_TO_LBS = 2.20462;
const LBS_TO_KG = 0.453592;

interface FormattedInputProps {
    value: number;
    onChange: (val: number) => void;
    placeholder?: string;
    className?: string;
    disabled?: boolean;
    required?: boolean;
    decimals?: number;
    step?: string;
}

export const FormattedInput: React.FC<FormattedInputProps> = ({
    value,
    onChange,
    placeholder,
    className,
    disabled,
    required,
    decimals = 2,
    step
}) => {
    const [isFocused, setIsFocused] = useState(false);
    const [displayValue, setDisplayValue] = useState('');

    // Sync display value when value prop changes externally (and not focused)
    useEffect(() => {
        if (!isFocused) {
            if (value === 0 || value === undefined || value === null) {
                // If strictly 0, we can show "0" or "0.00" depending on preference, 
                // but usually empty string or 0 is fine. Let's show formatted 0 if it's 0.
                setDisplayValue(value === 0 ? (0).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : '');
            } else {
                setDisplayValue(value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
            }
        }
    }, [value, isFocused, decimals]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        setDisplayValue(raw); // Let user type freely

        // Remove commas for parsing
        const clean = raw.replace(/,/g, '');
        const num = parseFloat(clean);

        if (!isNaN(num)) {
            onChange(num);
        } else {
            onChange(0);
        }
    };

    const handleBlur = () => {
        setIsFocused(false);
        // Re-format on blur
        if (value !== 0 && !value) {
            setDisplayValue('');
        } else {
            setDisplayValue(value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
        }
    };

    const handleFocus = () => {
        setIsFocused(true);
        // Show raw number for editing (remove commas), but keep decimals if they exist
        setDisplayValue(value === 0 ? '' : value.toString());
    };

    return (
        <input
            type={isFocused ? "number" : "text"}
            step={step}
            value={displayValue}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            disabled={disabled}
            required={required}
            className={className}
            placeholder={placeholder}
        />
    );
};

interface DualInputProps {
    value: number; // Always LBS or $/LB (The Source of Truth)
    onChange: (val: number) => void;
    label?: string;
    required?: boolean;
    placeholder?: string;
    disabled?: boolean;
}

export const QuantityInput: React.FC<DualInputProps> = ({ value, onChange, label = "Quantity", required, disabled }) => {
    // We rely on parent state for value. 
    // We calculate KG on the fly for display, but also allow editing it.

    const handleLbsChange = (val: number) => {
        onChange(val);
    };

    const handleKgChange = (val: number) => {
        const calculatedLbs = val * KG_TO_LBS;
        onChange(Number(calculatedLbs.toFixed(4))); // Keep precision internally
    };

    const kgValue = value ? value * LBS_TO_KG : 0;

    return (
        <div>
            {label && <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>}
            <div className="flex gap-2">
                <div className="flex-1 relative">
                    <FormattedInput
                        value={value}
                        onChange={handleLbsChange}
                        disabled={disabled}
                        required={required}
                        decimals={0}
                        className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-500 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="0"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-bold pointer-events-none">LBS</span>
                </div>
                <div className="flex-1 relative">
                    <FormattedInput
                        value={kgValue}
                        onChange={handleKgChange}
                        disabled={disabled}
                        decimals={0}
                        className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-500 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="0"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-bold pointer-events-none">KG</span>
                </div>
            </div>
        </div>
    );
};

export const PriceInput: React.FC<DualInputProps> = ({ value, onChange, label = "Price", required, disabled }) => {
    const handleLbPriceChange = (val: number) => {
        onChange(val);
    };

    const handleKgPriceChange = (val: number) => {
        const calculatedLbPrice = val * LBS_TO_KG;
        onChange(Number(calculatedLbPrice));
    };

    const kgValue = value ? value * KG_TO_LBS : 0;

    return (
        <div>
            {label && <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>}
            <div className="flex gap-2">
                <div className="flex-1 relative">
                    <FormattedInput
                        value={value}
                        onChange={handleLbPriceChange}
                        disabled={disabled}
                        required={required}
                        decimals={4}
                        step="0.0001"
                        className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-500 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="0.0000"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-bold pointer-events-none">$/LB</span>
                </div>
                <div className="flex-1 relative">
                    <FormattedInput
                        value={kgValue}
                        onChange={handleKgPriceChange}
                        disabled={disabled}
                        decimals={4}
                        step="0.0001"
                        className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-500 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="0.0000"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-bold pointer-events-none">$/KG</span>
                </div>
            </div>
        </div>
    );
};

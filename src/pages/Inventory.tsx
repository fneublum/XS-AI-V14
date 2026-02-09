
import React, { useState } from 'react';
import { InventoryItem, Product, Company, InventoryLog, User } from '../types';
import { Warehouse, Plus, X, Save, ArrowUpCircle, ArrowDownCircle, History, FileText, ClipboardList, Pencil, Calendar } from 'lucide-react';
import { QuantityInput } from '../components/UnitInputs';

interface InventoryProps {
    inventory: InventoryItem[];
    logs: InventoryLog[];
    onAdd: (i: InventoryItem) => void;
    onUpdate: (i: InventoryItem) => void;
    onDelete: (id: string) => void;
    onAddLog: (l: InventoryLog) => void;
    onUpdateLog: (l: InventoryLog) => void;
    onDeleteLog: (id: string) => void;
    products: Product[];
    currentCompanyId: string;
    availableCompanies: Company[];
    currentUser: User;
}

type ModalMode = 'NONE' | 'NEW' | 'INCREASE' | 'DECREASE' | 'EDIT_LOG';

const Inventory: React.FC<InventoryProps> = ({ 
    inventory, logs, onAdd, onUpdate, onDelete, onAddLog, onUpdateLog, onDeleteLog,
    products, currentCompanyId, availableCompanies, currentUser 
}) => {
  const [modalMode, setModalMode] = useState<ModalMode>('NONE');
  
  // Form State
  const initialFormState: Partial<InventoryItem> & { quantityChange: number, documentRef: string, logDate?: string, logId?: string } = {
      productId: '',
      productName: '',
      grade: '',
      quantityLBS: 0,
      warehouseLocation: '',
      notes: '',
      companyId: currentCompanyId === 'ALL' && availableCompanies.length > 0 ? availableCompanies[0].id : currentCompanyId,
      quantityChange: 0,
      documentRef: '',
      logDate: ''
  };

  const [formData, setFormData] = useState(initialFormState);
  const [selectedInventoryId, setSelectedInventoryId] = useState<string>('');

  // -- Derived Data for Summary --
  // Aggregate stock by Product Name + Grade
  const stockSummary = inventory.reduce((acc, item) => {
      const key = `${item.productName}-${item.grade}`;
      if (!acc[key]) {
          acc[key] = { name: item.productName, grade: item.grade, total: 0 };
      }
      acc[key].total += item.quantityLBS;
      return acc;
  }, {} as Record<string, {name: string, grade: string, total: number}>);

  const summaryList: {name: string, grade: string, total: number}[] = Object.values(stockSummary);

  // -- Handlers --

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const { name, value } = e.target;
      setFormData(prev => ({
          ...prev,
          [name]: name === 'quantityLBS' || name === 'quantityChange' ? Number(value) : value
      }));

      // Auto-fill details if adding new product
      if (name === 'productId' && modalMode === 'NEW') {
          const selectedProduct = products.find(p => p.id === value);
          if (selectedProduct) {
              setFormData(prev => ({
                  ...prev,
                  productId: value,
                  productName: selectedProduct.name,
                  grade: selectedProduct.grade,
              }));
          }
      }
  };

  const handleInventorySelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = e.target.value;
      setSelectedInventoryId(id);
      const item = inventory.find(i => i.id === id);
      if (item) {
          setFormData(prev => ({
              ...prev,
              ...item,
              quantityChange: 0,
              documentRef: ''
          }));
      }
  };

  const handleEditLog = (log: InventoryLog) => {
      setModalMode('EDIT_LOG');
      setFormData({
          ...initialFormState,
          logId: log.id,
          documentRef: log.documentReference,
          logDate: log.date
      });
  };

  const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      
      const today = new Date().toISOString().split('T')[0];
      const docRef = formData.documentRef || 'N/A';

      if (modalMode === 'NEW') {
          // 1. Create New Inventory Record
          const newItem: InventoryItem = {
              id: `INV${Date.now()}`,
              companyId: formData.companyId || currentCompanyId,
              productId: formData.productId || '',
              productName: formData.productName || 'Unknown',
              grade: formData.grade || '',
              quantityLBS: formData.quantityLBS || 0,
              warehouseLocation: formData.warehouseLocation || 'General',
              lastUpdated: today,
              notes: formData.notes
          };
          onAdd(newItem);

          // 2. Log Initial Entry
          const newLog: InventoryLog = {
              id: `L${Date.now()}`,
              companyId: newItem.companyId,
              inventoryId: newItem.id,
              productName: newItem.productName,
              grade: newItem.grade,
              type: 'INITIAL',
              quantityChange: newItem.quantityLBS,
              newQuantity: newItem.quantityLBS,
              documentReference: docRef,
              date: today,
              performedBy: currentUser.username
          };
          onAddLog(newLog);

      } else if (modalMode === 'INCREASE' || modalMode === 'DECREASE') {
          const originalItem = inventory.find(i => i.id === selectedInventoryId);
          if (!originalItem) return;

          const change = Number(formData.quantityChange);
          const newTotal = modalMode === 'INCREASE' 
              ? originalItem.quantityLBS + change 
              : Math.max(0, originalItem.quantityLBS - change);
          
          // 1. Update Inventory Record
          onUpdate({ 
              ...originalItem, 
              quantityLBS: newTotal, 
              lastUpdated: today 
          });

          // 2. Log Movement
          const newLog: InventoryLog = {
            id: `L${Date.now()}`,
            companyId: originalItem.companyId,
            inventoryId: originalItem.id,
            productName: originalItem.productName,
            grade: originalItem.grade,
            type: modalMode,
            quantityChange: change,
            newQuantity: newTotal,
            documentReference: docRef,
            date: today,
            performedBy: currentUser.username
        };
        onAddLog(newLog);

      } else if (modalMode === 'EDIT_LOG') {
          // Find original log
          const originalLog = logs.find(l => l.id === formData.logId);
          if (originalLog) {
              onUpdateLog({
                  ...originalLog,
                  documentReference: formData.documentRef,
                  date: formData.logDate || originalLog.date
              });
          }
      }

      setModalMode('NONE');
      setFormData(initialFormState);
      setSelectedInventoryId('');
  };

  return (
    <div className="space-y-8 pb-12">
       {/* Header */}
       <div>
          <h2 className="text-2xl font-bold text-slate-800">Inventory Management</h2>
          <p className="text-slate-500 text-sm">Track real-time stock levels, locations, and movements.</p>
       </div>

       {/* 1. Action Buttons */}
       <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
           <button 
                onClick={() => { setModalMode('NEW'); setFormData(initialFormState); }}
                className="bg-purple-600 hover:bg-purple-700 text-white p-6 rounded-xl shadow-md transition-all flex flex-col items-center justify-center gap-3 group"
            >
                <div className="bg-white/20 p-3 rounded-full group-hover:scale-110 transition-transform"><Plus size={32} /></div>
                <span className="font-bold text-lg">Add New Stock</span>
                <span className="text-xs opacity-80 font-normal">Create new SKU/Location record</span>
           </button>

           <button 
                onClick={() => { setModalMode('INCREASE'); setFormData(initialFormState); }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white p-6 rounded-xl shadow-md transition-all flex flex-col items-center justify-center gap-3 group"
            >
                <div className="bg-white/20 p-3 rounded-full group-hover:scale-110 transition-transform"><ArrowUpCircle size={32} /></div>
                <span className="font-bold text-lg">Increase Stock</span>
                <span className="text-xs opacity-80 font-normal">Inbound shipment / Adjustment</span>
           </button>

           <button 
                onClick={() => { setModalMode('DECREASE'); setFormData(initialFormState); }}
                className="bg-amber-600 hover:bg-amber-700 text-white p-6 rounded-xl shadow-md transition-all flex flex-col items-center justify-center gap-3 group"
            >
                <div className="bg-white/20 p-3 rounded-full group-hover:scale-110 transition-transform"><ArrowDownCircle size={32} /></div>
                <span className="font-bold text-lg">Decrease Stock</span>
                <span className="text-xs opacity-80 font-normal">Outbound / Consumption</span>
           </button>
       </div>

       {/* 2. Stock Summary (Resume) */}
       <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 bg-slate-50 border-b border-slate-200">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                    <ClipboardList size={18} className="text-blue-600" /> Stock Summary
                </h3>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Product Description</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Total (LBS)</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Total (KG)</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {summaryList.map((item, idx) => (
                            <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                <td className="px-6 py-4">
                                    <div className="flex items-center">
                                        <span className="font-bold text-slate-800 text-base">{item.name}</span>
                                        <span className="mx-2 text-slate-300">|</span>
                                        <span className="text-sm text-slate-500 font-medium">Grade: {item.grade}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <span className="text-lg font-bold text-blue-700 font-mono">{item.total.toLocaleString()}</span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <span className="text-base font-medium text-slate-500 font-mono">
                                        {(item.total * 0.453592).toLocaleString(undefined, {maximumFractionDigits: 0})}
                                    </span>
                                </td>
                            </tr>
                        ))}
                        {summaryList.length === 0 && (
                             <tr>
                                 <td colSpan={3} className="px-6 py-8 text-center text-slate-400 italic">No inventory data available.</td>
                             </tr>
                        )}
                    </tbody>
                </table>
            </div>
       </div>

       {/* 3. Activity Log Only */}
       <div className="grid grid-cols-1 gap-6">
           {/* Activity Log */}
           <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                <div className="p-4 bg-slate-50 border-b border-slate-200">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <History size={18} className="text-slate-500" /> Stock Activity Log
                    </h3>
                </div>
                <div className="overflow-x-auto flex-1 max-h-[600px]">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs text-slate-500 uppercase font-semibold sticky top-0">
                            <tr>
                                <th className="px-6 py-4">Date</th>
                                <th className="px-6 py-4">Action</th>
                                <th className="px-6 py-4">Product</th>
                                <th className="px-6 py-4">Document #</th>
                                <th className="px-6 py-4 text-right">Change</th>
                                <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {logs.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(log => (
                                <tr key={log.id} className="hover:bg-slate-50">
                                    <td className="px-6 py-4 text-xs text-slate-500 whitespace-nowrap">{log.date}</td>
                                    <td className="px-6 py-4">
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                            log.type === 'INITIAL' ? 'bg-purple-100 text-purple-700' :
                                            log.type === 'INCREASE' ? 'bg-emerald-100 text-emerald-700' :
                                            'bg-amber-100 text-amber-700'
                                        }`}>
                                            {log.type}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="font-medium text-slate-800">{log.productName}</span>
                                        <span className="text-xs text-slate-500 ml-1">({log.grade})</span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2 text-sm text-slate-700 font-mono bg-slate-50 px-2 py-1 rounded w-fit border border-slate-100">
                                            <FileText size={14} className="text-blue-400" /> 
                                            {log.documentReference || 'N/A'}
                                        </div>
                                    </td>
                                    <td className={`px-6 py-4 text-right font-mono font-bold text-base ${log.type === 'DECREASE' ? 'text-amber-600' : 'text-emerald-600'}`}>
                                        {log.type === 'DECREASE' ? '-' : '+'}{log.quantityChange.toLocaleString()}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button onClick={() => handleEditLog(log)} className="text-slate-400 hover:text-blue-600 transition-colors" title="Edit Log"><Pencil size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {logs.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic">No activity logs recorded yet.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
           </div>

       </div>

       {/* MODAL FOR ACTIONS */}
       {modalMode !== 'NONE' && (
           <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
               <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden animate-in zoom-in-95 duration-200">
                   {/* Header */}
                   <div className={`p-6 border-b border-slate-100 text-white flex justify-between items-center ${
                       modalMode === 'NEW' ? 'bg-purple-600' :
                       modalMode === 'INCREASE' ? 'bg-emerald-600' :
                       modalMode === 'DECREASE' ? 'bg-amber-600' : 'bg-slate-700'
                   }`}>
                       <h3 className="text-xl font-bold flex items-center gap-2">
                           {modalMode === 'NEW' && <Plus size={24} />}
                           {modalMode === 'INCREASE' && <ArrowUpCircle size={24} />}
                           {modalMode === 'DECREASE' && <ArrowDownCircle size={24} />}
                           {modalMode === 'EDIT_LOG' && <Pencil size={24} />}
                           {modalMode === 'NEW' ? 'Add New Stock' : 
                            modalMode === 'INCREASE' ? 'Inbound Stock' : 
                            modalMode === 'DECREASE' ? 'Outbound Stock' : 'Edit Log Entry'}
                       </h3>
                       <button onClick={() => setModalMode('NONE')} className="text-white/80 hover:text-white"><X size={24}/></button>
                   </div>
                   
                   <form onSubmit={handleSubmit} className="p-6 space-y-4">
                       
                       {/* Edit Log Specific Fields */}
                       {modalMode === 'EDIT_LOG' ? (
                           <>
                               <div>
                                   <label className="block text-sm font-bold text-slate-700 mb-1">Document Reference</label>
                                   <input required type="text" name="documentRef" value={formData.documentRef} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-3 py-2 text-sm" />
                               </div>
                               <div>
                                   <label className="block text-sm font-bold text-slate-700 mb-1">Date</label>
                                   <div className="relative">
                                       <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                       <input required type="date" name="logDate" value={formData.logDate} onChange={handleInputChange} className="w-full pl-9 pr-3 py-2 border border-slate-600 bg-slate-900 text-white rounded-lg text-sm" style={{ colorScheme: 'dark' }} />
                                   </div>
                               </div>
                               <div className="p-3 bg-amber-50 text-amber-700 text-xs rounded border border-amber-100">
                                   Note: Quantities cannot be edited on historical logs to preserve stock integrity. To fix a quantity error, please create a new adjustment entry.
                               </div>
                           </>
                       ) : (
                           /* Standard Stock Movement Fields */
                           <>
                               <div>
                                   <label className="block text-sm font-bold text-slate-700 mb-1">Document Reference *</label>
                                   <input required type="text" name="documentRef" value={formData.documentRef} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-3 py-2 text-sm focus:bg-slate-800 transition-colors" placeholder={modalMode === 'INCREASE' ? 'PO #, Invoice #' : modalMode === 'DECREASE' ? 'Sales Order #, BOL' : 'Initial PO #'} />
                               </div>

                               {/* New Mode Fields */}
                               {modalMode === 'NEW' && (
                                   <>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Product</label>
                                            <select required name="productId" value={formData.productId} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white rounded-lg px-3 py-2 text-sm">
                                                <option value="">Select Product...</option>
                                                {products.filter(p => currentCompanyId === 'ALL' ? (formData.companyId ? p.companyId === formData.companyId : true) : true).map(p => <option key={p.id} value={p.id}>{p.name} - {p.grade}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Warehouse Location</label>
                                            <input required name="warehouseLocation" value={formData.warehouseLocation} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Houston Dock 4" />
                                        </div>
                                        <div className="mt-2">
                                            <QuantityInput 
                                                label="Initial Quantity"
                                                value={formData.quantityLBS || 0}
                                                onChange={(val) => setFormData(prev => ({...prev, quantityLBS: val}))}
                                            />
                                        </div>
                                   </>
                               )}

                               {/* Increase/Decrease Mode Fields */}
                               {(modalMode === 'INCREASE' || modalMode === 'DECREASE') && (
                                   <>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Select Inventory Item</label>
                                            <select required value={selectedInventoryId} onChange={handleInventorySelect} className="w-full border border-slate-600 bg-slate-900 text-white rounded-lg px-3 py-2 text-sm">
                                                <option value="">Choose item to adjust...</option>
                                                {inventory.map(i => <option key={i.id} value={i.id}>{i.productName} ({i.grade}) - {i.warehouseLocation} [{i.quantityLBS} LBS]</option>)}
                                            </select>
                                        </div>
                                        {selectedInventoryId && (
                                            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 mb-2">
                                                <p className="text-xs text-slate-500 uppercase font-bold">Current Stock</p>
                                                <p className="text-lg font-bold text-slate-700">{formData.quantityLBS.toLocaleString()} LBS</p>
                                            </div>
                                        )}
                                        <div className="mt-2">
                                            <QuantityInput 
                                                label={`Quantity to ${modalMode === 'INCREASE' ? 'Add' : 'Remove'}`}
                                                value={formData.quantityChange || 0}
                                                onChange={(val) => setFormData(prev => ({...prev, quantityChange: val}))}
                                            />
                                        </div>
                                   </>
                               )}
                           </>
                       )}

                       <button 
                            type="submit" 
                            className={`w-full text-white font-bold py-3 rounded-lg mt-4 flex items-center justify-center gap-2 ${
                                modalMode === 'NEW' ? 'bg-purple-600 hover:bg-purple-700' :
                                modalMode === 'INCREASE' ? 'bg-emerald-600 hover:bg-emerald-700' :
                                modalMode === 'DECREASE' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-slate-700 hover:bg-slate-800'
                            }`}
                        >
                           <Save size={18} /> {modalMode === 'EDIT_LOG' ? 'Update Log Entry' : 'Confirm Transaction'}
                       </button>
                   </form>
               </div>
           </div>
       )}
    </div>
  );
};

export default Inventory;



import React, { useState } from 'react';
import { Company } from '../types';
import { Building, Building2, Plus, X, Save, Trash2, Pencil, MapPin, Tag, Phone, Hash } from 'lucide-react';

interface AdminCompaniesProps {
  companies: Company[];
  onAdd: (c: Company) => void;
  onUpdate: (c: Company) => void;
  onDelete: (id: string) => void;
}

const AdminCompanies: React.FC<AdminCompaniesProps> = ({ companies, onAdd, onUpdate, onDelete }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Company>>({
    name: '', nickname: '', address: '', city: '', state: '', zip: '', country: '', ein: '', phone: ''
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleEdit = (company: Company, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(company.id);
    setFormData(company);
    setIsAdding(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (editingId) {
      onUpdate({ ...formData, id: editingId } as Company);
    } else {
      const newCompany: Company = {
        id: `COMP${Date.now()}`,
        name: formData.name!,
        nickname: formData.nickname,
        address: formData.address,
        city: formData.city,
        state: formData.state,
        zip: formData.zip,
        country: formData.country,
        ein: formData.ein,
        phone: formData.phone
      };
      onAdd(newCompany);
    }

    setIsAdding(false);
    setEditingId(null);
    setFormData({ name: '', nickname: '', address: '', city: '', state: '', zip: '', country: '', ein: '', phone: '' });
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Deleting a company may orphan Users, Customers, and Products linked to it. Are you sure you want to proceed?')) {
      onDelete(id);
      // If we deleted the item currently being edited, close the form
      if (editingId === id) {
        setIsAdding(false);
        setEditingId(null);
        setFormData({ name: '', nickname: '', address: '', city: '', state: '', zip: '', country: '', ein: '', phone: '' });
      }
    }
  };

  const handleAddNew = () => {
    setIsAdding(true);
    setEditingId(null);
    setFormData({ name: '', nickname: '', address: '', city: '', state: '', zip: '', country: '', ein: '', phone: '' });
  };

  return (
    <div className="space-y-6">
      <div className="mb-6 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-r from-slate-600 to-slate-700 rounded-xl text-white"><Building2 size={24} /></div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Company Management</h1>
            <p className="text-slate-500 text-sm mt-1">Create and manage tenant organizations</p>
          </div>
        </div>
        <button onClick={handleAddNew} className="flex items-center gap-2 px-5 py-2.5 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-all shadow-md font-medium">
          <Plus size={18} /> Add Company
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={`${isAdding ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">ID</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Company Name</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Location</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {companies.map(company => (
                  <tr key={company.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 text-sm font-mono text-slate-500">{company.id}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center text-slate-500"><Building size={16} /></div>
                        <div>
                          <span className="font-medium text-slate-800 block">{company.name}</span>
                          {company.nickname && <span className="text-xs text-blue-600 font-medium">{company.nickname}</span>}
                          {company.address && <span className="text-xs text-slate-400 block">{company.address}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">{company.city && company.country ? `${company.city}, ${company.country}` : <span className="text-slate-300 text-xs italic">No address</span>}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={(e) => handleEdit(company, e)} className="text-slate-400 hover:text-amber-500 transition-colors"><Pencil size={16} /></button>
                        <button type="button" onClick={(e) => handleDelete(company.id, e)} className="text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {isAdding && (
          <div className="bg-white p-6 rounded-xl shadow-lg border border-slate-200 h-fit animate-in slide-in-from-right duration-300">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-slate-800">{editingId ? 'Edit Company' : 'New Company'}</h3>
              <button onClick={() => setIsAdding(false)}><X size={20} className="text-slate-400" /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Company Name *</label><div className="relative"><Building size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input required name="name" value={formData.name} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 pl-9 text-sm" placeholder="e.g. Acme Distributions" /></div></div>
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nickname / Abbreviation</label><div className="relative"><Tag size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input name="nickname" value={formData.nickname || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 pl-9 text-sm" placeholder="e.g. ACME" /></div></div>
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 space-y-3">
                <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2 mb-2"><MapPin size={12} /> Address Details</h4>
                <div><label className="block text-xs font-medium text-slate-700 mb-1">Street Address</label><input name="address" value={formData.address || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="123 Industrial Parkway" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-medium text-slate-700 mb-1">City</label><input name="city" value={formData.city || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" /></div>
                  <div><label className="block text-xs font-medium text-slate-700 mb-1">State/Prov</label><input name="state" value={formData.state || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-medium text-slate-700 mb-1">Zip/Postal</label><input name="zip" value={formData.zip || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" /></div>
                  <div><label className="block text-xs font-medium text-slate-700 mb-1">Country</label><input name="country" value={formData.country || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" /></div>
                </div>
              </div>
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 space-y-3">
                <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2 mb-2"><Hash size={12} /> EIN & Contact</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-medium text-slate-700 mb-1">EIN Number</label><div className="relative"><Hash size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input name="ein" value={(formData as any).ein || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 pl-9 text-sm" placeholder="XX-XXXXXXX" /></div></div>
                  <div><label className="block text-xs font-medium text-slate-700 mb-1">Phone</label><div className="relative"><Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input name="phone" value={(formData as any).phone || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 pl-9 text-sm" placeholder="+1 (555) 123-4567" /></div></div>
                </div>
              </div>
              <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 rounded hover:bg-blue-700 mt-2 flex items-center justify-center gap-2"><Save size={16} /> {editingId ? 'Update Company' : 'Create Company'}</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminCompanies;

import React, { useState } from 'react';
import { User, Role, Company, CargoAgent, Customer } from '../types';
import { Plus, X, Save, Trash2, Pencil, Users, Shield, Building, Truck, User as UserIcon, Lock } from 'lucide-react';
import { AVAILABLE_TASKS } from '../components/Dock';

interface AdminUsersProps {
  users: User[];
  onAdd: (u: User) => void;
  onUpdate: (u: User) => void;
  onDelete: (id: string) => void;
  companies: Company[];
  cargoAgents: CargoAgent[];
  currentUser: User;
  customers: Customer[];
}

const AdminUsers: React.FC<AdminUsersProps> = ({ users, onAdd, onUpdate, onDelete, companies, cargoAgents, currentUser, customers }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<User>>({
    name: '', username: '', password: '', role: Role.USER, avatarInitials: '', email: '', phone: '', allowed_company_ids: [], allowed_modules: []
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleCompanyToggle = (companyId: string) => {
    setFormData(prev => {
      const current = prev.allowed_company_ids || [];
      if (current.includes(companyId)) {
        return { ...prev, allowed_company_ids: current.filter(id => id !== companyId) };
      } else {
        return { ...prev, allowed_company_ids: [...current, companyId] };
      }
    });
  };

  const handleCustomerLinkChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const custId = e.target.value;
    const customer = customers.find(c => c.id === custId);

    setFormData(prev => ({
      ...prev,
      linked_entity_id: custId,
      // Auto-select the company this customer belongs to
      allowed_company_ids: customer ? [customer.companyId] : []
    }));
  };

  const handleEdit = (user: User) => {
    setEditingId(user.id);
    setFormData(user);
    setIsAdding(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Auto-assign companies for non-Admins (e.g. CEO creating a User inherits CEO's companies)
    let finalCompanyIds = formData.allowed_company_ids || [];
    if (currentUser.role !== Role.ADMIN && formData.role !== Role.CUSTOMER) {
      finalCompanyIds = currentUser.allowed_company_ids || [];
    }

    if (editingId) {
      onUpdate({
        ...formData,
        id: editingId,
        allowed_company_ids: currentUser.role === Role.ADMIN || formData.role === Role.CUSTOMER ? formData.allowed_company_ids : finalCompanyIds
      } as User);
    } else {
      const newUser: User = {
        id: `USR${Date.now()}`,
        name: formData.name!,
        username: formData.username!,
        password: formData.password || '123456',
        role: formData.role || Role.USER,
        avatarInitials: formData.name ? formData.name.substring(0, 2).toUpperCase() : 'U',
        email: formData.email,
        phone: formData.phone,
        allowed_company_ids: finalCompanyIds,
        allowed_modules: formData.allowed_modules,
        linked_entity_id: formData.linked_entity_id
      };
      onAdd(newUser);
    }
    setIsAdding(false);
    setEditingId(null);
    setFormData({ name: '', username: '', password: '', role: Role.USER, avatarInitials: '', email: '', phone: '', allowed_company_ids: [], allowed_modules: [] });
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Delete user?')) {
      onDelete(id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">User Management</h2>
          <p className="text-slate-500 text-sm">Create accounts and assign roles/companies</p>
        </div>
        <button onClick={() => { setIsAdding(true); setEditingId(null); setFormData({ name: '', username: '', password: '', role: Role.USER, avatarInitials: '', email: '', phone: '', allowed_company_ids: [] }); }} className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-900 transition-colors">
          <Plus size={18} /> Add User
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={`${isAdding ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">User</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Role</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Companies</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map(user => (
                  <tr key={user.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-bold text-xs">{user.avatarInitials}</div>
                        <div>
                          <span className="font-medium text-slate-800 block">{user.name}</span>
                          <span className="text-xs text-slate-500">{user.username}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600"><span className="bg-slate-100 px-2 py-1 rounded text-xs font-bold">{user.role}</span></td>
                    <td className="px-6 py-4 text-sm text-slate-600">{user.allowed_company_ids?.length || 0} Assigned</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => handleEdit(user)} className="text-slate-400 hover:text-amber-500 transition-colors"><Pencil size={16} /></button>
                        <button onClick={() => handleDelete(user.id)} className="text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
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
              <h3 className="font-bold text-slate-800">{editingId ? 'Edit User' : 'New User'}</h3>
              <button onClick={() => setIsAdding(false)}><X size={20} className="text-slate-400" /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Full Name</label><input required name="name" value={formData.name} onChange={handleInputChange} className="w-full border border-slate-300 rounded p-2 text-sm" placeholder="John Doe" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Username</label><input required name="username" value={formData.username} onChange={handleInputChange} className="w-full border border-slate-300 rounded p-2 text-sm" placeholder="jdoe" /></div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Password</label><input name="password" value={formData.password} onChange={handleInputChange} className="w-full border border-slate-300 rounded p-2 text-sm" placeholder="******" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email</label><input type="email" name="email" value={formData.email || ''} onChange={handleInputChange} className="w-full border border-slate-300 rounded p-2 text-sm" placeholder="john@example.com" /></div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Phone</label><input type="tel" name="phone" value={formData.phone || ''} onChange={handleInputChange} className="w-full border border-slate-300 rounded p-2 text-sm" placeholder="+1 555-0123" /></div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Role</label>
                <select name="role" value={formData.role} onChange={handleInputChange} className="w-full border border-slate-300 rounded p-2 text-sm">
                  <option value={Role.USER}>User</option>
                  <option value={Role.MANAGER}>Manager</option>
                  {currentUser.role === Role.ADMIN && <option value={Role.ADMIN}>Admin</option>}
                  <option value={Role.CEO}>CEO</option>
                  <option value={Role.CARGO_AGENT}>Cargo Agent</option>
                  <option value={Role.CUSTOMER}>Customer</option>
                </select>
              </div>

              {formData.role === Role.CARGO_AGENT && (
                <div className="bg-blue-50 p-3 rounded border border-blue-100">
                  <label className="block text-xs font-bold text-blue-800 uppercase mb-1 flex items-center gap-1"><Truck size={12} /> Linked Agent Profile</label>
                  <select name="linked_entity_id" value={formData.linked_entity_id || ''} onChange={handleInputChange} className="w-full border border-blue-200 rounded p-2 text-sm">
                    <option value="">Select Agent...</option>
                    {cargoAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <p className="text-[10px] text-blue-600 mt-1">This user will only see freight/logistics data for the selected agent.</p>
                </div>
              )}

              {formData.role === Role.CUSTOMER && (
                <div className="bg-emerald-50 p-3 rounded border border-emerald-100">
                  <label className="block text-xs font-bold text-emerald-800 uppercase mb-1 flex items-center gap-1"><UserIcon size={12} /> Linked Customer Profile</label>
                  <select
                    name="linked_entity_id"
                    value={formData.linked_entity_id || ''}
                    onChange={handleCustomerLinkChange}
                    className="w-full border border-emerald-200 rounded p-2 text-sm"
                  >
                    <option value="">Select Customer...</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <p className="text-[10px] text-emerald-600 mt-1">This user will be restricted to data relevant to this customer account. The Company Access below will auto-update.</p>
                </div>
              )}

              {/* Company Access - ONLY VISIBLE TO ADMIN */}
              {currentUser.role === Role.ADMIN && (formData.role === Role.MANAGER || formData.role === Role.USER || formData.role === Role.CARGO_AGENT || formData.role === Role.CEO || formData.role === Role.CUSTOMER) && (
                <div className="bg-slate-50 p-3 rounded border border-slate-100">
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2 flex items-center gap-1"><Building size={12} /> Company Access</label>
                  <div className="space-y-2 max-h-32 overflow-y-auto custom-scrollbar">
                    {companies.length > 0 ? companies.map(company => (
                      <label key={company.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer hover:bg-slate-100 p-1 rounded select-none">
                        <input type="checkbox" checked={(formData.allowed_company_ids || []).includes(company.id)} onChange={() => handleCompanyToggle(company.id)} className="rounded text-blue-600 focus:ring-blue-500" />{company.name}
                      </label>
                    )) : <p className="text-xs text-slate-400 italic">No companies available.</p>}
                  </div>
                </div>
              )}

              {/* Menu Access - ONLY VISIBLE TO ADMIN WHEN ROLE IS USER */}
              {currentUser.role === Role.ADMIN && formData.role === Role.USER && (
                <div className="bg-purple-50 p-3 rounded border border-purple-100">
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-xs font-bold text-purple-800 uppercase flex items-center gap-1"><Lock size={12} /> Menu Access</label>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setFormData(prev => ({ ...prev, allowed_modules: [] }))} className="text-[10px] text-purple-600 hover:underline">None</button>
                      <button type="button" onClick={() => setFormData(prev => ({ ...prev, allowed_modules: AVAILABLE_TASKS.filter(t => !t.isSpacer).map(t => t.id) }))} className="text-[10px] text-purple-600 hover:underline">All</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto custom-scrollbar p-1">
                    {AVAILABLE_TASKS.filter(t => !t.isSpacer).map(task => (
                      <label key={task.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:bg-purple-100/50 p-1 rounded select-none">
                        <input
                          type="checkbox"
                          checked={(formData.allowed_modules || []).includes(task.id)}
                          onChange={() => {
                            const current = formData.allowed_modules || [];
                            setFormData(prev => ({
                              ...prev,
                              allowed_modules: current.includes(task.id)
                                ? current.filter(id => id !== task.id)
                                : [...current, task.id]
                            }));
                          }}
                          className="rounded text-purple-600 focus:ring-purple-500"
                        />
                        <div className="flex items-center gap-1.5 overflow-hidden">
                          <task.icon size={12} className={task.color === 'red' ? 'text-red-500' : task.color === 'blue' ? 'text-blue-500' : task.color === 'green' ? 'text-emerald-500' : 'text-slate-500'} />
                          <span className="truncate">{task.label}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                  <p className="text-[10px] text-purple-600 mt-2">Selected menus will be the only ones visible to this user.</p>
                </div>
              )}

              <button type="submit" className="w-full bg-slate-800 text-white font-bold py-2 rounded hover:bg-slate-900 mt-2 flex items-center justify-center gap-2"><Save size={16} /> {editingId ? 'Update User' : 'Create User'}</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminUsers;
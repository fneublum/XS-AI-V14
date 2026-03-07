
import React, { useState } from 'react';
import { User, Role, Company, CargoAgent, Customer, Product } from '../types';
import { Plus, X, Save, Trash2, Pencil, Users, Shield, Building, Truck, User as UserIcon, Lock, Tag } from 'lucide-react';
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
  products: Product[];
}

const AdminUsers: React.FC<AdminUsersProps> = ({ users, onAdd, onUpdate, onDelete, companies, cargoAgents, currentUser, customers, products }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<User>>({
    name: '', username: '', password: '', role: Role.USER, avatarInitials: '', email: '', phone: '', allowed_company_ids: [], allowed_modules: [], allowed_product_categories: []
  });

  // Extract unique product categories from all products
  const uniqueCategories = React.useMemo(() => {
    const cats = new Set<string>();
    products.forEach(p => { if (p.category) cats.add(p.category); });
    return Array.from(cats).sort();
  }, [products]);

  const handleCategoryToggle = (category: string) => {
    setFormData(prev => {
      const current = prev.allowed_product_categories || [];
      if (current.includes(category)) {
        return { ...prev, allowed_product_categories: current.filter(c => c !== category) };
      } else {
        return { ...prev, allowed_product_categories: [...current, category] };
      }
    });
  };

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
        linked_entity_id: formData.linked_entity_id,
        allowed_product_categories: formData.allowed_product_categories
      };
      onAdd(newUser);
    }
    setIsAdding(false);
    setEditingId(null);
    setFormData({ name: '', username: '', password: '', role: Role.USER, avatarInitials: '', email: '', phone: '', allowed_company_ids: [], allowed_modules: [], allowed_product_categories: [] });
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Delete user?')) {
      onDelete(id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="mb-6 flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="p-2 bg-gradient-to-r from-slate-600 to-slate-700 rounded-xl text-white">
            <Shield size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">User Management</h1>
            <p className="text-slate-500 text-sm">Create accounts and assign roles/companies</p>
          </div>
        </div>
        <button onClick={() => { setIsAdding(true); setEditingId(null); setFormData({ name: '', username: '', password: '', role: Role.USER, avatarInitials: '', email: '', phone: '', allowed_company_ids: [], allowed_product_categories: [] }); }} className="flex items-center gap-2 px-5 py-2.5 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-all shadow-md font-medium">
          <Plus size={18} /> Add User
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">User</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Role</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Companies</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Categories</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map(user => (
              <tr key={user.id} className="hover:bg-slate-50">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-bold text-[10px] flex-shrink-0">{user.avatarInitials}</div>
                    <div className="min-w-0">
                      <span className="font-medium text-slate-800 text-sm block truncate">{user.name}</span>
                      <span className="text-[11px] text-slate-400">{user.username}</span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2 text-sm text-slate-600"><span className="bg-slate-100 px-2 py-0.5 rounded text-xs font-bold">{user.role}</span></td>
                <td className="px-4 py-2 text-xs text-slate-500">{user.allowed_company_ids?.length || 0} Assigned</td>
                <td className="px-4 py-2 text-xs text-slate-500">{user.allowed_product_categories?.length ? `${user.allowed_product_categories.length} Cats` : 'All'}</td>
                <td className="px-4 py-2 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <button onClick={() => handleEdit(user)} className="text-slate-400 hover:text-amber-500 transition-colors p-1"><Pencil size={14} /></button>
                    <button onClick={() => handleDelete(user.id)} className="text-slate-400 hover:text-red-500 transition-colors p-1"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal Form for Add/Edit User */}
      {isAdding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center p-6 border-b border-slate-100">
              <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                {editingId ? <Pencil size={20} className="text-amber-500" /> : <Plus size={20} className="text-blue-600" />}
                {editingId ? 'Edit User' : 'New User'}
              </h3>
              <button onClick={() => { setIsAdding(false); setEditingId(null); }} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-full transition-all"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Full Name</label><input required name="name" value={formData.name} onChange={handleInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="John Doe" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Username</label><input required name="username" value={formData.username} onChange={handleInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="jdoe" /></div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Password</label><input name="password" value={formData.password} onChange={handleInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="******" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email</label><input type="email" name="email" value={formData.email || ''} onChange={handleInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="john@example.com" /></div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Phone</label><input type="tel" name="phone" value={formData.phone || ''} onChange={handleInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="+1 555-0123" /></div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Role</label>
                <select name="role" value={formData.role} onChange={handleInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                  <option value={Role.USER}>User</option>
                  <option value={Role.MANAGER}>Manager</option>
                  {currentUser.role === Role.ADMIN && <option value={Role.ADMIN}>Admin</option>}
                  <option value={Role.CEO}>CEO</option>
                  <option value={Role.CARGO_AGENT}>Cargo Agent</option>
                  <option value={Role.CUSTOMER}>Customer</option>
                  <option value={Role.SALES}>Sales</option>
                </select>
              </div>

              {/* Company Access */}
              {currentUser.role === Role.ADMIN && formData.role !== Role.ADMIN && (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-2 flex items-center gap-1"><Building size={14} /> Company Access</label>
                  <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto custom-scrollbar p-1">
                    {companies.length > 0 ? companies.map(company => (
                      <label key={company.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer hover:bg-slate-100 p-1.5 rounded select-none">
                        <input type="checkbox" checked={(formData.allowed_company_ids || []).includes(company.id)} onChange={() => handleCompanyToggle(company.id)} className="rounded text-blue-600 focus:ring-blue-500" />{company.name}
                      </label>
                    )) : <p className="text-xs text-slate-400 italic col-span-2">No companies available.</p>}
                  </div>
                </div>
              )}

              {/* Product Category Access */}
              {currentUser.role === Role.ADMIN && formData.role !== Role.ADMIN && (
                <div className="bg-teal-50 p-4 rounded-xl border border-teal-100">
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-xs font-bold text-teal-800 uppercase flex items-center gap-1"><Tag size={14} /> Product Categories</label>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setFormData(prev => ({ ...prev, allowed_product_categories: [] }))} className="text-[10px] text-teal-600 hover:underline">None</button>
                      <button type="button" onClick={() => setFormData(prev => ({ ...prev, allowed_product_categories: [...uniqueCategories] }))} className="text-[10px] text-teal-600 hover:underline">All</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto custom-scrollbar p-1">
                    {uniqueCategories.length > 0 ? uniqueCategories.map(cat => (
                      <label key={cat} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:bg-teal-100/50 p-1.5 rounded select-none">
                        <input
                          type="checkbox"
                          checked={(formData.allowed_product_categories || []).includes(cat)}
                          onChange={() => handleCategoryToggle(cat)}
                          className="rounded text-teal-600 focus:ring-teal-500"
                        />
                        <span className="truncate">{cat}</span>
                      </label>
                    )) : <p className="text-xs text-slate-400 italic col-span-2">No product categories found.</p>}
                  </div>
                  <p className="text-[10px] text-teal-600 mt-2">Leave empty for access to ALL categories. Selected categories restrict product visibility.</p>
                </div>
              )}

              {formData.role === Role.CARGO_AGENT && (
                <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                  <label className="block text-xs font-bold text-blue-800 uppercase mb-1 flex items-center gap-1"><Truck size={14} /> Linked Agent Profile</label>
                  <select name="linked_entity_id" value={formData.linked_entity_id || ''} onChange={handleInputChange} className="w-full border border-blue-200 rounded-lg p-2.5 text-sm">
                    <option value="">Select Agent...</option>
                    {[...cargoAgents].sort((a, b) => a.name.localeCompare(b.name)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <p className="text-[10px] text-blue-600 mt-1">This user will only see freight/logistics data for the selected agent.</p>
                </div>
              )}

              {formData.role === Role.CUSTOMER && (
                <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100">
                  <label className="block text-xs font-bold text-emerald-800 uppercase mb-1 flex items-center gap-1"><UserIcon size={14} /> Linked Customer Profile</label>
                  <select
                    name="linked_entity_id"
                    value={formData.linked_entity_id || ''}
                    onChange={handleCustomerLinkChange}
                    className="w-full border border-emerald-200 rounded-lg p-2.5 text-sm"
                  >
                    <option value="">Select Customer...</option>
                    {[...customers].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <p className="text-[10px] text-emerald-600 mt-1">This user will be restricted to data relevant to this customer account. The Company Access below will auto-update.</p>
                </div>
              )}

              {/* Menu Access - ONLY FOR USER ROLE */}
              {currentUser.role === Role.ADMIN && formData.role === Role.USER && (
                <div className="bg-purple-50 p-4 rounded-xl border border-purple-100">
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-xs font-bold text-purple-800 uppercase flex items-center gap-1"><Lock size={14} /> Menu Access</label>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setFormData(prev => ({ ...prev, allowed_modules: [] }))} className="text-[10px] text-purple-600 hover:underline">None</button>
                      <button type="button" onClick={() => setFormData(prev => ({ ...prev, allowed_modules: AVAILABLE_TASKS.filter(t => !t.isSpacer).map(t => t.id) }))} className="text-[10px] text-purple-600 hover:underline">All</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 max-h-56 overflow-y-auto custom-scrollbar p-1">
                    {AVAILABLE_TASKS.filter(t => !t.isSpacer).map(task => (
                      <label key={task.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:bg-purple-100/50 p-1.5 rounded select-none">
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

              <button type="submit" className="w-full bg-slate-800 text-white font-bold py-3 rounded-lg hover:bg-slate-900 mt-2 flex items-center justify-center gap-2"><Save size={16} /> {editingId ? 'Update User' : 'Create User'}</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminUsers;
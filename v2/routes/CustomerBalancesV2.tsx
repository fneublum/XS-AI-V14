// Phase 3B — v2 Customer Balances.
//
// This file used to be a handoff stub to v1 FinanceBalances. It's now
// a pass-through to the full v2 port in FinanceBalancesV2. The AppV2
// route 'customer-balances' still points here so the Finance pop-up
// menu and command palette entries keep working without churn.

import React from 'react';
import FinanceBalancesV2 from './FinanceBalancesV2';

const CustomerBalancesV2: React.FC = () => <FinanceBalancesV2 />;

export default CustomerBalancesV2;

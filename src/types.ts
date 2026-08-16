export interface Client {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  address: string;
  taxNumber: string;
  notes: string;
  status: 'active' | 'inactive';
  revenue: number;
  quotesCount: number;
  invoicesCount: number;
  lastActivity: string;
}

export interface ProductService {
  id: string;
  name: string;
  description: string;
  category: string;
  unitType: string;
  unitPrice: number;
  taxRate: number;
  status: 'active' | 'inactive';
}

export interface BillingItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  tax: number;
  amount: number;
}

export interface Quote {
  id: string;
  quoteNumber: string;
  clientId: string;
  clientName: string;
  quoteDate: string;
  expiryDate: string;
  items: BillingItem[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
  status: 'draft' | 'sent' | 'converted' | 'expired';
  notes: string;
  terms: string;
}

export interface PaymentRecord {
  id: string;
  paymentDate: string;
  paymentMethod: 'cash' | 'bank_transfer' | 'cheque' | 'mobile_transfer' | 'other';
  referenceNumber: string;
  amountPaid: number;
  notes: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  quoteId?: string;
  quoteNumber?: string;
  clientId: string;
  clientName: string;
  issueDate: string;
  dueDate: string;
  items: BillingItem[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
  status: 'draft' | 'pending' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';
  payments: PaymentRecord[];
  balanceRemaining: number;
  notes: string;
  terms: string;
}

export interface CompanySettings {
  companyName: string;
  email: string;
  phone: string;
  address: string;
  taxNumber: string;
  bankDetails?: string;
  bank_details?: string;
  currency: string;
  invoiceFormat: string;
  quoteFormat: string;
  termsTemplate: string;
  emailTemplate: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager';
}

export interface DBState {
  clients: Client[];
  products: ProductService[];
  quotes: Quote[];
  invoices: Invoice[];
  settings: CompanySettings;
}

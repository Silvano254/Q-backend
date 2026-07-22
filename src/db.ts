import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import { DBState, Client, ProductService, Quote, Invoice, CompanySettings } from './types.js';

const DB_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'server-db.json');

// Ensure database directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

export const defaultSettings: CompanySettings = {
  companyName: "Binti Events",
  email: "billing@bintievents.co.ke",
  phone: "+254 712 345678",
  address: "Sura Office Suites, Nairobi, Kenya",
  taxNumber: "P051234567A",
  currency: "KES",
  invoiceFormat: "INV-2026-{SEQ}",
  quoteFormat: "QT-2026-{SEQ}",
  termsTemplate: "1. Payments are non-refundable for cancellations within 14 days of the event.\n2. 50% deposit required to book, with balance due 7 days prior to event setup.\n3. Broken or damaged hire equipment will be charged at replacement cost.",
  emailTemplate: "Dear {CLIENT_NAME},\n\nPlease find attached {TYPE} {NUMBER} from Binti Events.\n\nTotal Amount: {CURRENCY} {AMOUNT}\nDue Date: {DUE_DATE}\n\nThank you for choosing Binti Events to curate your luxury moments.\n\nWarm regards,\nBinti Events Billing Team"
};

export const defaultClients: Client[] = [];

export const defaultProducts: ProductService[] = [
  {
    id: "p1",
    name: "Premium Stretch Tent (15m x 30m)",
    description: "Elegant waterproof, sand-colored heavy-duty stretch tent with double peaks.",
    category: "Tents",
    unitType: "Day",
    unitPrice: 55000,
    taxRate: 16,
    status: "active"
  },
  {
    id: "p2",
    name: "Luxury Pergola Wooden Structure",
    description: "3m x 6m wooden pergola structure, complete with elegant white fabric draping.",
    category: "Structures",
    unitType: "Setup",
    unitPrice: 85000,
    taxRate: 16,
    status: "active"
  },
  {
    id: "p3",
    name: "Cheese Tent (Semi-open)",
    description: "Modern, stylish cheese tent for garden parties and brand activations.",
    category: "Tents",
    unitType: "Day",
    unitPrice: 35000,
    taxRate: 16,
    status: "active"
  },
  {
    id: "p4",
    name: "Ambient Fairy Lights & Uplighting Pack",
    description: "Warm glow LED up-lighting and 100m fairy lights including setup and technical support.",
    category: "Lighting",
    unitType: "Event",
    unitPrice: 20000,
    taxRate: 16,
    status: "active"
  },
  {
    id: "p5",
    name: "Chiavari Luxury Chairs (Gold/White)",
    description: "Standard premium Chiavari wooden chairs with cushion pads.",
    category: "Furniture",
    unitType: "Piece",
    unitPrice: 350,
    taxRate: 16,
    status: "active"
  },
  {
    id: "p6",
    name: "Full Tabletop Decor Styling Pack",
    description: "Includes glass underplates, gold cutlery, fabric napkins, crystal glassware, and table runner.",
    category: "Decor",
    unitType: "Guest",
    unitPrice: 800,
    taxRate: 16,
    status: "active"
  },
  {
    id: "p7",
    name: "Floral Arch & Backdrop Design",
    description: "Bespoke fresh floral installations matching custom color palettes.",
    category: "Decor",
    unitType: "Setup",
    unitPrice: 75000,
    taxRate: 16,
    status: "active"
  },
  {
    id: "p8",
    name: "Transport & Event Logistics Support",
    description: "Nairobi area heavy truck transport, layout design, offloading, and rigging labor.",
    category: "Logistics",
    unitType: "Flat Rate",
    unitPrice: 30000,
    taxRate: 16,
    status: "active"
  },
  {
    id: "p9",
    name: "Creative Event Design & Consultation",
    description: "3D venue mapping, event coordination meetings, and dedicated site manager.",
    category: "Consultation",
    unitType: "Hour",
    unitPrice: 15000,
    taxRate: 16,
    status: "active"
  }
];

export const defaultQuotes: Quote[] = [];
export const defaultInvoices: Invoice[] = [];

// MongoDB setup
const mongoUri = process.env.MONGODB_URI;
let mongoClient: MongoClient | null = null;
let dbName = 'binti-events';

if (mongoUri) {
  try {
    mongoClient = new MongoClient(mongoUri);
    const urlParts = mongoUri.split('/');
    const lastPart = urlParts[urlParts.length - 1];
    const cleanDbName = lastPart.split('?')[0];
    if (cleanDbName) {
      dbName = cleanDbName;
    }
    console.log(`MongoDB connection string found. Target database: "${dbName}"`);
  } catch (err) {
    console.error("Failed to parse MONGODB_URI. Falling back to local file database.", err);
  }
}

let connectionPromise: Promise<any> | null = null;

async function getMongoCollection() {
  if (!mongoClient) return null;
  if (!connectionPromise) {
    connectionPromise = mongoClient.connect().then(() => {
      console.log("Connected to MongoDB successfully.");
    }).catch(err => {
      console.error("MongoDB connection failed. Falling back to local file database.", err);
      mongoClient = null;
    });
  }
  await connectionPromise;
  if (!mongoClient) return null;
  return mongoClient.db(dbName).collection('app_state');
}

export async function readDB(): Promise<DBState> {
  const collection = await getMongoCollection();
  
  if (collection) {
    try {
      const document = await collection.findOne({ _id: 'current_state' });
      if (document) {
        const { _id, ...state } = document;
        return state as DBState;
      } else {
        const initialState: DBState = {
          clients: defaultClients,
          products: defaultProducts,
          quotes: defaultQuotes,
          invoices: defaultInvoices,
          settings: defaultSettings
        };
        await collection.updateOne(
          { _id: 'current_state' },
          { $set: initialState },
          { upsert: true }
        );
        return initialState;
      }
    } catch (err) {
      console.error("Failed to read from MongoDB. Falling back to local JSON reading.", err);
    }
  }

  // Fallback to local JSON file
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initialState: DBState = {
        clients: defaultClients,
        products: defaultProducts,
        quotes: defaultQuotes,
        invoices: defaultInvoices,
        settings: defaultSettings
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initialState, null, 2));
      return initialState;
    }
    const data = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading database file", error);
    return {
      clients: defaultClients,
      products: defaultProducts,
      quotes: defaultQuotes,
      invoices: defaultInvoices,
      settings: defaultSettings
    };
  }
}

export async function writeDB(state: DBState): Promise<void> {
  const collection = await getMongoCollection();
  
  if (collection) {
    try {
      await collection.updateOne(
        { _id: 'current_state' },
        { $set: state },
        { upsert: true }
      );
      return;
    } catch (err) {
      console.error("Failed to write to MongoDB. Falling back to local JSON writing.", err);
    }
  }

  // Fallback to local JSON file
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error("Error writing database file", error);
  }
}

export function updateClientStats(state: DBState) {
  state.clients = state.clients.map(client => {
    const clientInvoices = state.invoices.filter(i => i.clientId === client.id);
    const clientQuotes = state.quotes.filter(q => q.clientId === client.id);
    
    const revenue = clientInvoices.reduce((sum, inv) => {
      const paidSum = inv.payments.reduce((pSum, pm) => pSum + pm.amountPaid, 0);
      return sum + paidSum;
    }, 0);

    return {
      ...client,
      revenue,
      quotesCount: clientQuotes.length,
      invoicesCount: clientInvoices.length,
      lastActivity: new Date().toISOString().split("T")[0]
    };
  });
}

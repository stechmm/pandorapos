// Restaurant POS Mock Data with 1-Level Colorful Category Structure

const initialCategories = [
  { id: "c1", name: "စားစရာ", color: "#f8a5c2" },      // Soft Pink
  { id: "c2", name: "သောက်စရာ", color: "#a8e6cf" },    // Soft Mint Green
  { id: "c3", name: "အချိုပွဲ", color: "#ffd3b6" }       // Soft Peach/Orange
];

const initialProducts = [
  {
    id: "p1",
    name: "ကြက်သားဆီချက်ခေါက်ဆွဲ",
    price: 3500,
    categoryId: "c1",
    color: "#ff7b00",
    track_inventory: false,
    stock: 0
  },
  {
    id: "p2",
    name: "ဝက်သားတုတ်ထိုး (တစ်ပွဲ)",
    price: 5000,
    categoryId: "c1",
    color: "#ff0055",
    track_inventory: false,
    stock: 0
  },
  {
    id: "p3",
    name: "ထမင်းကြော်",
    price: 3000,
    categoryId: "c1",
    color: "#ffb700",
    track_inventory: false,
    stock: 0,
    options: [
      { name: "ကြက်သား", priceModifier: 0, isDefault: true },
      { name: "ဝက်သား", priceModifier: 1000 },
      { name: "ပင်လယ်စာ", priceModifier: 2000 }
    ]
  },
  {
    id: "p4",
    name: "လက်ဖက်သုပ် (အထူး)",
    price: 2500,
    categoryId: "c1",
    color: "#00b894",
    track_inventory: false,
    stock: 0
  },
  {
    id: "p5",
    name: "အုန်းနို့ခေါက်ဆွဲ",
    price: 2500,
    categoryId: "c1",
    color: "#d63031",
    track_inventory: false,
    stock: 0
  },
  {
    id: "p6",
    name: "ရေခဲမုန့်သီးစုံ",
    price: 3000,
    categoryId: "c3",
    color: "#fd79a8",
    track_inventory: false,
    stock: 0
  },
  {
    id: "p7",
    name: "Coca Cola",
    price: 1500,
    categoryId: "c2",
    color: "#e74c3c",
    track_inventory: true,
    stock: 20
  },
  {
    id: "p8",
    name: "ရေသန့်ဗူး",
    price: 700,
    categoryId: "c2",
    color: "#2ecc71",
    track_inventory: true,
    stock: 35
  },
  {
    id: "p9",
    name: "Orange Soda",
    price: 1200,
    categoryId: "c2",
    color: "#f39c12",
    track_inventory: true,
    stock: 18
  },
  {
    id: "p10",
    name: "ဖရဲသီးဖျော်ရည်",
    price: 1800,
    categoryId: "c2",
    color: "#1abc9c",
    track_inventory: false,
    stock: 0
  }
];

const initialTables = [
  { id: 1, name: "Table 1", status: "available", seats: 2, activeOrderId: null, x: 10, y: 15, floor: "main" },
  { id: 2, name: "Table 2", status: "occupied", seats: 4, activeOrderId: "ord-101", x: 35, y: 15, floor: "main" },
  { id: 3, name: "Table 3", status: "available", seats: 4, activeOrderId: null, x: 60, y: 15, floor: "main" },
  { id: 4, name: "Table 4", status: "occupied", seats: 6, activeOrderId: "ord-102", x: 80, y: 15, floor: "main" },
  { id: 5, name: "Table 5", status: "available", seats: 2, activeOrderId: null, x: 10, y: 60, floor: "2nd" },
  { id: 6, name: "Table 6", status: "billed", seats: 4, activeOrderId: "ord-103", x: 35, y: 60, floor: "2nd" },
  { id: 7, name: "Table 7", status: "available", seats: 8, activeOrderId: null, x: 60, y: 60, floor: "2nd" },
  { id: 8, name: "Table 8", status: "available", seats: 4, activeOrderId: null, x: 80, y: 60, floor: "2nd" }
];


const initialOrders = [
  {
    id: "ord-101",
    tableId: 2,
    tableName: "Table 2",
    type: "dine-in",
    items: [
      { id: "p1", name: "ကြက်သားဆီချက်ခေါက်ဆွဲ", price: 3500, quantity: 2, note: "အစပ်လျှော့" },
      { id: "p7", name: "အိုင်စကော်ဖီ", price: 2000, quantity: 2, note: "" }
    ],
    subtotal: 11000,
    discount: 500,
    tax: 550,
    total: 11050,
    status: "preparing",
    timestamp: "2026-06-30T21:40:00"
  },
  {
    id: "ord-102",
    tableId: 4,
    tableName: "Table 4",
    type: "dine-in",
    items: [
      { id: "p3", name: "ထမင်းကြော် (ကြက်/ဝက်)", price: 3000, quantity: 3, note: "ဝက်သားကြော်" },
      { id: "p8", name: "ထိုင်းလက်ဖက်ရည်အေး", price: 2200, quantity: 3, note: "" },
      { id: "p2", name: "ဝက်သားတုတ်ထိုး (တစ်ပွဲ)", price: 5000, quantity: 1, note: "" }
    ],
    subtotal: 20600,
    discount: 0,
    tax: 1030,
    total: 21630,
    status: "preparing",
    timestamp: "2026-06-30T22:05:00"
  },
  {
    id: "ord-103",
    tableId: 6,
    tableName: "Table 6",
    type: "dine-in",
    items: [
      { id: "p5", name: "အုန်းနို့ခေါက်ဆွဲ", price: 2500, quantity: 1, note: "" },
      { id: "p9", name: "ပူတင်း", price: 2500, quantity: 1, note: "" }
    ],
    subtotal: 5000,
    discount: 0,
    tax: 250,
    total: 5250,
    status: "billed",
    timestamp: "2026-06-30T21:15:00"
  }
];

// Historical Completed Sales (For Dashboard Analytics)
const initialSalesHistory = [
  {
    id: "ord-095",
    tableName: "Table 1",
    type: "dine-in",
    items: [
      { id: "p1", name: "ကြက်သားဆီချက်ခေါက်ဆွဲ", price: 3500, quantity: 3 },
      { id: "p9", name: "ပူတင်း", price: 2500, quantity: 2 }
    ],
    subtotal: 15000,
    discount: 1000,
    tax: 700,
    total: 14700,
    timestamp: "2026-06-30T12:30:00"
  },
  {
    id: "ord-096",
    tableName: "Takeaway",
    type: "takeaway",
    items: [
      { id: "p1", name: "ကြက်သားဆီချက်ခေါက်ဆွဲ", price: 3500, quantity: 1 },
      { id: "p6", name: "ရေခဲမုန့်သီးစုံ", price: 3000, quantity: 1 }
    ],
    subtotal: 6500,
    discount: 0,
    tax: 325,
    total: 6825,
    timestamp: "2026-06-30T13:15:00"
  },
  {
    id: "ord-097",
    tableName: "Table 5",
    type: "dine-in",
    items: [
      { id: "p3", name: "ထမင်းကြော် (ကြက်/ဝက်)", price: 3000, quantity: 2 },
      { id: "p6", name: "ရေခဲမုန့်သီးစုံ", price: 3000, quantity: 1 }
    ],
    subtotal: 9000,
    discount: 500,
    tax: 425,
    total: 8925,
    timestamp: "2026-06-30T14:45:00"
  },
  {
    id: "ord-098",
    tableName: "Table 3",
    type: "dine-in",
    items: [
      { id: "p1", name: "ကြက်သားဆီချက်ခေါက်ဆွဲ", price: 3500, quantity: 7 }
    ],
    subtotal: 24500,
    discount: 1500,
    tax: 1150,
    total: 24150,
    timestamp: "2026-06-30T18:20:00"
  },
  {
    id: "ord-099",
    tableName: "Takeaway",
    type: "takeaway",
    items: [
      { id: "p3", name: "ထမင်းကြော် (ကြက်/ဝက်)", price: 3000, quantity: 4 }
    ],
    subtotal: 12000,
    discount: 0,
    tax: 600,
    total: 12600,
    timestamp: "2026-06-30T19:40:00"
  },
  {
    id: "ord-100",
    tableName: "Table 8",
    type: "dine-in",
    items: [
      { id: "p1", name: "ကြက်သားဆီချက်ခေါက်ဆွဲ", price: 3500, quantity: 3 },
      { id: "p7", name: "အိုင်စကော်ဖီ", price: 2000, quantity: 4 }
    ],
    subtotal: 18500,
    discount: 1000,
    tax: 875,
    total: 18375,
    timestamp: "2026-06-30T20:10:00"
  }
];

const initialMarketExpenses = [
  {
    id: "exp-1",
    itemName: "ကြက်သား (၅ ပိဿာ)",
    cost: 75000,
    quantity: "5 kg",
    date: "2026-06-30",
    notes: "မနက်ဈေးမှ ဝယ်ယူခဲ့သည် - လတ်ဆတ်သည်",
    addedToInventory: false
  },
  {
    id: "exp-2",
    itemName: "ကော်ဖီမစ်စေ့ (၃ ထုပ်)",
    cost: 45000,
    quantity: "3 packs",
    date: "2026-06-30",
    notes: "အိုင်စကော်ဖီအတွက် - စတော့ပေါင်းထည့်ပြီး",
    addedToInventory: true,
    productId: "p7",
    addQty: 30
  },
  {
    id: "exp-3",
    itemName: "ဟင်းသီးဟင်းရွက်စုံ",
    cost: 15000,
    quantity: "1 lot",
    date: "2026-06-30",
    notes: "ထမင်းကြော်နှင့် ဆီချက်အတွက်",
    addedToInventory: false
  }
];

const initialSettings = {
  restaurantName: "Pandora POS",
  currency: "MMK",
  taxRate: 5, // percentage
  serviceCharge: 0, // percentage
  darkMode: true,
  printerName: "POS-80 Kitchen Printer (Simulated)",
  drinksPrinterName: "POS-80 Drinks Printer (Simulated)",
  voucherTitle: "Pandora POS",
  voucherAddress: "",
  voucherPhone: "",
  voucherFooter: "Thank you for your purchase.",
  voucherShowLogo: true,
  voucherPaperSize: "80mm"
};

const initialUsers = [
  { id: "u1", username: "admin", password: "123", role: "admin", name: "Admin 1" },
  { id: "u2", username: "cashier", password: "123", role: "cashier", name: "မလှလှ (Cashier)" },
  { id: "u3", username: "waiter", password: "123", role: "waiter", name: "မောင်ထွန်း (Waiter)" }
];

initialMarketExpenses.splice(0, initialMarketExpenses.length,
  {
    id: "exp-1",
    itemName: "ကြက်သား (၅ ပိဿာ)",
    cost: 75000,
    quantity: "5 kg",
    date: "2026-06-30",
    notes: "မနက်ဈေးမှ ဝယ်ယူခဲ့သည်",
    addedToInventory: false
  },
  {
    id: "exp-2",
    itemName: "ကော်ဖီမစ်စေ့ (၃ ထုပ်)",
    cost: 45000,
    quantity: "3 packs",
    date: "2026-06-30",
    notes: "စတော့ထည့်ပြီး",
    addedToInventory: true,
    productId: "p7",
    addQty: 30
  },
  {
    id: "exp-3",
    itemName: "ဟင်းသီးဟင်းရွက်စုံ",
    cost: 15000,
    quantity: "1 lot",
    date: "2026-06-30",
    notes: "နေ့စဉ်အသုံးပြုရန်",
    addedToInventory: false
  }
);

initialUsers.splice(0, initialUsers.length,
  { id: "u1", username: "admin", password: "123", role: "admin", name: "Admin 1" },
  { id: "u2", username: "cashier", password: "123", role: "cashier", name: "Cashier 1" },
  { id: "u3", username: "waiter", password: "123", role: "waiter", name: "Waiter 1" },
  { id: "u4", username: "owner", password: "123", role: "owner", name: "Owner", allowedTabs: ["dashboard-pane", "reports-pane"] }
);

initialCategories.splice(0, initialCategories.length,
  { id: "c1", name: "Food", color: "#10b981" },
  { id: "c2", name: "Drink", color: "#3b82f6" },
  { id: "c3", name: "Meat", color: "#f43f5e" },
  { id: "c4", name: "Salad", color: "#14b8a6" },
  { id: "c5", name: "Fried", color: "#f59e0b" }
);

initialProducts.splice(0, initialProducts.length,
  { id: "p1", name: "Chicken Noodle", price: 3500, categoryId: "c1", color: "#10b981", track_inventory: false, stock: 0 },
  { id: "p2", name: "Pork Skewer", price: 5000, categoryId: "c3", color: "#f43f5e", track_inventory: false, stock: 0 },
  {
    id: "p3",
    name: "Fried Rice",
    price: 3000,
    categoryId: "c5",
    color: "#f59e0b",
    track_inventory: false,
    stock: 0,
    options: [
      { name: "Chicken", priceModifier: 0, isDefault: true },
      { name: "Pork", priceModifier: 1000 },
      { name: "Seafood", priceModifier: 2000 }
    ]
  },
  { id: "p4", name: "Tea Leaf Salad", price: 2500, categoryId: "c4", color: "#14b8a6", track_inventory: false, stock: 0 },
  { id: "p5", name: "Coconut Noodle", price: 2500, categoryId: "c1", color: "#10b981", track_inventory: false, stock: 0 },
  { id: "p6", name: "Fruit Ice Cream", price: 3000, categoryId: "c1", color: "#10b981", track_inventory: false, stock: 0 },
  { id: "p7", name: "Coca Cola", price: 1500, categoryId: "c2", color: "#3b82f6", track_inventory: true, stock: 20 },
  { id: "p8", name: "Water", price: 700, categoryId: "c2", color: "#3b82f6", track_inventory: true, stock: 35 },
  { id: "p9", name: "Orange Soda", price: 1200, categoryId: "c2", color: "#3b82f6", track_inventory: true, stock: 18 },
  { id: "p10", name: "Watermelon Juice", price: 1800, categoryId: "c2", color: "#3b82f6", track_inventory: false, stock: 0 }
);

const initialInventory = [
  { id: "inv-1", name: "Coca Cola", stock: 48, unit: "pcs", minStock: 10 },
  { id: "inv-2", name: "Water", stock: 120, unit: "bottles", minStock: 20 },
  { id: "inv-3", name: "Noodle Pack", stock: 60, unit: "packs", minStock: 15 },
  { id: "inv-4", name: "Eggs", stock: 180, unit: "pcs", minStock: 30 }
];

const initialInventoryTransactions = [
  { id: "tx-1", itemId: "inv-1", itemName: "Coca Cola", qty: 48, type: "add", notes: "Initial setup", timestamp: new Date().toISOString() }
];

const initialCustomers = [
  { id: "cust-1", name: "Customer 1", phone: "09771234567", points: 150, totalSpending: 150000 },
  { id: "cust-2", name: "Customer 2", phone: "09778765432", points: 340, totalSpending: 340000 },
  { id: "cust-3", name: "Customer 3", phone: "09440987654", points: 0, totalSpending: 0 }
];

initialOrders.splice(0, initialOrders.length,
  {
    id: "ord-101",
    tableId: 2,
    tableName: "Table 2",
    type: "dine-in",
    items: [
      { id: "p1", name: "Chicken Noodle", price: 3500, quantity: 2, note: "Less spicy" },
      { id: "p7", name: "Coca Cola", price: 1500, quantity: 2, note: "" }
    ],
    subtotal: 10000,
    discount: 0,
    tax: 500,
    total: 10500,
    status: "preparing",
    timestamp: new Date(Date.now() - 8 * 60000).toISOString()
  }
);

initialMarketExpenses.splice(0, initialMarketExpenses.length,
  {
    id: "exp-1",
    itemName: "Chicken",
    cost: 75000,
    quantity: "5 kg",
    date: "2026-06-30",
    notes: "Morning market purchase",
    addedToInventory: false
  },
  {
    id: "exp-2",
    itemName: "Coffee Beans",
    cost: 45000,
    quantity: "3 packs",
    date: "2026-06-30",
    notes: "Added to stock",
    addedToInventory: true,
    productId: "p7",
    addQty: 30
  },
  {
    id: "exp-3",
    itemName: "Vegetable Set",
    cost: 15000,
    quantity: "1 lot",
    date: "2026-06-30",
    notes: "Daily kitchen use",
    addedToInventory: false
  }
);

// Export to window object for browser access
window.POS_MOCK_DATA = {
  // Offline demo install: seed useful restaurant data immediately.
  categories: initialCategories,
  products: initialProducts,
  tables: initialTables,
  orders: initialOrders,
  salesHistory: initialSalesHistory,
  marketExpenses: initialMarketExpenses,
  inventory: initialInventory,
  inventoryTransactions: initialInventoryTransactions,
  customers: initialCustomers,
  settings: initialSettings,
  users: initialUsers
};

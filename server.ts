import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fs from 'fs';

const app = express();
const PORT = 3000;
const JWT_SECRET = 'agroconnect-secret-key-123';
const DB_PATH = path.join(process.cwd(), 'db.json');

app.use(cors());
app.use(express.json());

// --- Database Persistence Helpers ---
const saveDB = (data: any) => {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to save database:', err);
  }
};

const loadDB = () => {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load database:', err);
  }
  return null;
};

// --- In-Memory Database (Synced with File) ---
let db = loadDB() || {
  users: [] as any[],
  products: [] as any[],
  orders: [] as any[],
  messages: [] as any[],
  vehicles: [] as any[],
};

// Initialize some dummy data if DB is empty
if (db.users.length === 0) {
  db.users.push({
    id: 'farmer1',
    name: 'Rajesh Patil',
    email: 'farmer@example.com',
    password: bcrypt.hashSync('password123', 8),
    role: 'farmer',
    location: 'Nashik, Maharashtra',
  });

  db.users.push({
    id: 'buyer1',
    name: 'Mumbai Fresh Mart',
    email: 'buyer@example.com',
    password: bcrypt.hashSync('password123', 8),
    role: 'buyer',
    location: 'Mumbai, Maharashtra',
  });

  db.users.push({
    id: 'transporter1',
    name: 'Suresh Logistics',
    email: 'transport@example.com',
    password: bcrypt.hashSync('password123', 8),
    role: 'transporter',
    location: 'Pune, Maharashtra',
  });

  db.products.push({
    id: 'prod1',
    farmerId: 'farmer1',
    name: 'Alphonso Mangoes',
    quantity: 500, // kg
    quality: 'Grade A - Premium',
    price: 150, // INR per kg
    images: ['https://images.unsplash.com/photo-1553279768-865429fa0078?auto=format&fit=crop&q=80&w=400'],
    status: 'available',
    createdAt: new Date().toISOString(),
  });
  
  saveDB(db);
}

// --- Middleware ---
const authenticate = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// --- API Routes ---

// Auth Routes
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, role, location } = req.body;
  if (db.users.find((u: any) => u.email === email)) {
    return res.status(400).json({ message: 'Email already exists' });
  }
  const newUser = {
    id: `user_${Date.now()}`,
    name,
    email,
    password: bcrypt.hashSync(password, 8),
    role,
    location,
  };
  db.users.push(newUser);
  saveDB(db);
  const token = jwt.sign({ id: newUser.id, role: newUser.role }, JWT_SECRET, { expiresIn: '1d' });
  res.json({ token, user: { id: newUser.id, name, email, role, location } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.users.find((u: any) => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1d' });
  res.json({ token, user: { id: user.id, name: user.name, email, role: user.role, location: user.location } });
});

app.get('/api/auth/me', authenticate, (req: any, res) => {
  const user = db.users.find((u: any) => u.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, location: user.location } });
});

// Product Routes
app.get('/api/products', (req, res) => {
  const { farmerId } = req.query;
  let products = db.products;
  if (farmerId) {
    products = products.filter((p: any) => p.farmerId === farmerId);
  }
  // Attach farmer details
  const enrichedProducts = products.map((p: any) => {
    const farmer = db.users.find((u: any) => u.id === p.farmerId);
    return { ...p, farmerName: farmer?.name, farmerLocation: farmer?.location };
  });
  res.json(enrichedProducts);
});

app.post('/api/products', authenticate, (req: any, res) => {
  if (req.user.role !== 'farmer') return res.status(403).json({ message: 'Only farmers can add products' });
  const newProduct = {
    id: `prod_${Date.now()}`,
    farmerId: req.user.id,
    ...req.body,
    createdAt: new Date().toISOString(),
  };
  db.products.push(newProduct);
  saveDB(db);
  res.json(newProduct);
});

// Order Routes
app.post('/api/orders', authenticate, (req: any, res) => {
  if (req.user.role !== 'buyer') return res.status(403).json({ message: 'Only buyers can place orders' });
  const { productId, quantity, totalPrice } = req.body;
  const product = db.products.find((p: any) => p.id === productId);
  if (!product) return res.status(404).json({ message: 'Product not found' });
  if (product.quantity < quantity) {
    return res.status(400).json({ message: 'Insufficient stock available' });
  }

  // Decrease stock
  product.quantity -= quantity;
  if (product.quantity === 0) product.status = 'out_of_stock';
  
  const newOrder = {
    id: `ord_${Date.now()}`,
    buyerId: req.user.id,
    farmerId: product.farmerId,
    productId,
    quantity,
    totalPrice,
    status: 'Pending',
    trackingHistory: [{ status: 'Order Placed', timestamp: new Date().toISOString(), location: product.farmerLocation }],
    createdAt: new Date().toISOString(),
  };
  db.orders.push(newOrder);
  saveDB(db);
  res.json(newOrder);
});

app.get('/api/orders', authenticate, (req: any, res) => {
  const userId = req.user.id;
  const role = req.user.role;
  
  let orders;
  if (role === 'farmer') {
    orders = db.orders.filter((o: any) => o.farmerId === userId);
  } else if (role === 'buyer') {
    orders = db.orders.filter((o: any) => o.buyerId === userId);
  } else if (role === 'transporter') {
    orders = db.orders.filter((o: any) => o.transporterId === userId || o.status === 'Pending');
  } else {
    orders = [];
  }
  
  // Enrich orders
  const enrichedOrders = orders.map((o: any) => {
    const product = db.products.find((p: any) => p.id === o.productId);
    const farmer = db.users.find((u: any) => u.id === o.farmerId);
    const buyer = db.users.find((u: any) => u.id === o.buyerId);
    const transporter = db.users.find((u: any) => u.id === o.transporterId);
    
    return {
      ...o,
      productName: product?.name,
      productImage: product?.images[0],
      farmerName: farmer?.name,
      farmerLocation: farmer?.location,
      buyerName: buyer?.name,
      buyerLocation: buyer?.location,
      otherPartyName: role === 'farmer' ? buyer?.name : (role === 'buyer' ? farmer?.name : farmer?.name),
      otherPartyLocation: role === 'farmer' ? buyer?.location : (role === 'buyer' ? farmer?.location : farmer?.location),
      transporterName: transporter?.name,
    };
  });
  res.json(enrichedOrders);
});

app.put('/api/orders/:id/accept-transport', authenticate, (req: any, res) => {
  if (req.user.role !== 'transporter') return res.status(403).json({ message: 'Only transporters can accept jobs' });
  const order = db.orders.find((o: any) => o.id === req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  if (order.transporterId) return res.status(400).json({ message: 'Order already accepted by another transporter' });

  order.transporterId = req.user.id;
  order.status = 'Processing';
  order.trackingHistory.push({ 
    status: 'Transporter Assigned', 
    timestamp: new Date().toISOString(), 
    location: db.users.find((u: any) => u.id === req.user.id)?.location 
  });
  saveDB(db);
  res.json(order);
});

app.put('/api/orders/:id/status', authenticate, (req: any, res) => {
  const { status, location } = req.body;
  const order = db.orders.find((o: any) => o.id === req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });

  // Permissions: Farmer can update status to Shipped, Transporter can update to In Transit/Delivered
  if (req.user.role === 'farmer' && order.farmerId === req.user.id) {
    if (status !== 'Shipped') return res.status(403).json({ message: 'Farmers can only mark as Shipped' });
  } else if (req.user.role === 'transporter' && order.transporterId === req.user.id) {
    if (!['In Transit', 'Delivered'].includes(status)) return res.status(403).json({ message: 'Invalid status for transporter' });
  } else {
    return res.status(403).json({ message: 'Unauthorized status update' });
  }
  
  const validStatuses = ['Pending', 'Processing', 'Shipped', 'In Transit', 'Delivered'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }

  order.status = status;
  order.trackingHistory.push({ status, timestamp: new Date().toISOString(), location: location || 'Logistics Center' });
  saveDB(db);
  res.json(order);
});

// Chat Routes
app.get('/api/chat/:userId', authenticate, (req: any, res) => {
  const otherUserId = req.params.userId;
  const messages = db.messages.filter(
    (m: any) => (m.senderId === req.user.id && m.receiverId === otherUserId) || 
           (m.senderId === otherUserId && m.receiverId === req.user.id)
  );
  res.json(messages);
});

app.post('/api/chat', authenticate, (req: any, res) => {
  const { receiverId, text } = req.body;
  const newMessage = {
    id: `msg_${Date.now()}`,
    senderId: req.user.id,
    receiverId,
    text,
    timestamp: new Date().toISOString(),
  };
  db.messages.push(newMessage);
  saveDB(db);
  res.json(newMessage);
});

// --- Vite Integration ---
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

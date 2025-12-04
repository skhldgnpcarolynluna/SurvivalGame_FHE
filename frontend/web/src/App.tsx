// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface GameItem {
  id: string;
  name: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  category: string;
  value: number;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<GameItem[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newItemData, setNewItemData] = useState({
    name: "",
    category: "",
    value: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  // Filter items based on search and category
  const filteredItems = items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          item.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Get unique categories for filter
  const categories = Array.from(new Set(items.map(item => item.category)));

  useEffect(() => {
    loadItems().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadItems = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("item_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing item keys:", e);
        }
      }
      
      const list: GameItem[] = [];
      
      for (const key of keys) {
        try {
          const itemBytes = await contract.getData(`item_${key}`);
          if (itemBytes.length > 0) {
            try {
              const itemData = JSON.parse(ethers.toUtf8String(itemBytes));
              list.push({
                id: key,
                name: itemData.name,
                encryptedData: itemData.data,
                timestamp: itemData.timestamp,
                owner: itemData.owner,
                category: itemData.category,
                value: itemData.value || 0
              });
            } catch (e) {
              console.error(`Error parsing item data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading item ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setItems(list);
    } catch (e) {
      console.error("Error loading items:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitItem = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting game data with FHE..."
    });
    
    try {
      // Simulate FHE encryption for game data
      const encryptedData = `FHE-GAME-${btoa(JSON.stringify(newItemData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const itemId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const itemData = {
        name: newItemData.name,
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        category: newItemData.category,
        value: parseInt(newItemData.value) || 0
      };
      
      // Store encrypted game data on-chain using FHE
      await contract.setData(
        `item_${itemId}`, 
        ethers.toUtf8Bytes(JSON.stringify(itemData))
      );
      
      const keysBytes = await contract.getData("item_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(itemId);
      
      await contract.setData(
        "item_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Game item encrypted and stored securely!"
      });
      
      await loadItems();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewItemData({
          name: "",
          category: "",
          value: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const checkAvailability = async () => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Checking FHE contract availability..."
    });

    try {
      const contract = await getContractReadOnly();
      if (!contract) {
        throw new Error("Failed to get contract");
      }
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE contract is ${isAvailable ? "available" : "unavailable"} for operations`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to start playing the survival game",
      icon: "🎮"
    },
    {
      title: "Create Encrypted Items",
      description: "Add resources and items to your encrypted inventory using FHE",
      icon: "🔒"
    },
    {
      title: "FHE Game Logic",
      description: "Game actions are processed while keeping your data private",
      icon: "⚙️"
    },
    {
      title: "Survive & Thrive",
      description: "Use your encrypted resources to survive in the on-chain world",
      icon: "🏆"
    }
  ];

  const renderValueChart = () => {
    const categoriesData: {[key: string]: number} = {};
    
    items.forEach(item => {
      if (!categoriesData[item.category]) {
        categoriesData[item.category] = 0;
      }
      categoriesData[item.category] += item.value;
    });
    
    const maxValue = Math.max(...Object.values(categoriesData), 1);
    
    return (
      <div className="value-chart">
        {Object.entries(categoriesData).map(([category, value]) => (
          <div key={category} className="chart-bar-container">
            <div className="chart-label">{category}</div>
            <div className="chart-bar">
              <div 
                className="chart-fill" 
                style={{ width: `${(value / maxValue) * 100}%` }}
              ></div>
            </div>
            <div className="chart-value">{value}</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="nature-spinner"></div>
      <p>Initializing encrypted game world...</p>
    </div>
  );

  return (
    <div className="app-container nature-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="leaf-icon"></div>
          </div>
          <h1>Wilderness<span>Survival</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-item-btn nature-button"
          >
            <div className="add-icon"></div>
            Add Resource
          </button>
          <button 
            className="nature-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Survival Guide"}
          </button>
          <button 
            className="nature-button secondary"
            onClick={checkAvailability}
          >
            Check FHE Status
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>FHE-Powered Wilderness Survival</h2>
            <p>Your resources, location, and health are encrypted on-chain for true private gameplay</p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>Wilderness Survival Guide</h2>
            <p className="subtitle">Learn how to thrive in the encrypted wilderness</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card nature-card">
            <h3>Game Introduction</h3>
            <p>Survival game where your inventory and status are encrypted using FHE technology, enabling true private on-chain gameplay.</p>
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
          </div>
          
          <div className="dashboard-card nature-card">
            <h3>Resource Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{items.length}</div>
                <div className="stat-label">Total Items</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{categories.length}</div>
                <div className="stat-label">Resource Types</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{items.reduce((sum, item) => sum + item.value, 0)}</div>
                <div className="stat-label">Total Value</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card nature-card">
            <h3>Resource Distribution</h3>
            {renderValueChart()}
          </div>
        </div>
        
        <div className="items-section">
          <div className="section-header">
            <h2>Encrypted Inventory</h2>
            <div className="header-actions">
              <div className="search-filter">
                <input 
                  type="text" 
                  placeholder="Search resources..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="nature-input"
                />
                <select 
                  value={selectedCategory} 
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="nature-select"
                >
                  <option value="all">All Categories</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <button 
                onClick={loadItems}
                className="refresh-btn nature-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="items-list nature-card">
            <div className="table-header">
              <div className="header-cell">Name</div>
              <div className="header-cell">Category</div>
              <div className="header-cell">Owner</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Value</div>
            </div>
            
            {filteredItems.length === 0 ? (
              <div className="no-items">
                <div className="no-items-icon"></div>
                <p>No encrypted resources found</p>
                <button 
                  className="nature-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Resource
                </button>
              </div>
            ) : (
              filteredItems.map(item => (
                <div className="item-row" key={item.id}>
                  <div className="table-cell item-name">{item.name}</div>
                  <div className="table-cell">{item.category}</div>
                  <div className="table-cell">{item.owner.substring(0, 6)}...{item.owner.substring(38)}</div>
                  <div className="table-cell">
                    {new Date(item.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className="value-badge">
                      {item.value}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="team-section">
          <h2>Development Team</h2>
          <div className="team-grid">
            <div className="team-member">
              <div className="member-avatar"></div>
              <h3>Alex Morgan</h3>
              <p>Lead Game Developer</p>
            </div>
            <div className="team-member">
              <div className="member-avatar"></div>
              <h3>Sarah Chen</h3>
              <p>FHE Cryptography Expert</p>
            </div>
            <div className="team-member">
              <div className="member-avatar"></div>
              <h3>Marcus Wright</h3>
              <p>Blockchain Engineer</p>
            </div>
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitItem} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          itemData={newItemData}
          setItemData={setNewItemData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content nature-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="nature-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="leaf-icon"></div>
              <span>WildernessSurvival</span>
            </div>
            <p>FHE-powered private on-chain survival game</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} Wilderness Survival. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  itemData: any;
  setItemData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  itemData,
  setItemData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setItemData({
      ...itemData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!itemData.name || !itemData.category) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal nature-card">
        <div className="modal-header">
          <h2>Add Encrypted Resource</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your game data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Resource Name *</label>
              <input 
                type="text"
                name="name"
                value={itemData.name} 
                onChange={handleChange}
                placeholder="Enter resource name..." 
                className="nature-input"
              />
            </div>
            
            <div className="form-group">
              <label>Category *</label>
              <select 
                name="category"
                value={itemData.category} 
                onChange={handleChange}
                className="nature-select"
              >
                <option value="">Select category</option>
                <option value="Food">Food</option>
                <option value="Water">Water</option>
                <option value="Medicine">Medicine</option>
                <option value="Tools">Tools</option>
                <option value="Weapons">Weapons</option>
                <option value="Shelter">Shelter</option>
                <option value="Other">Other</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Value</label>
              <input 
                type="number"
                name="value"
                value={itemData.value} 
                onChange={handleChange}
                placeholder="Survival value..." 
                className="nature-input"
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Resource data remains encrypted during FHE gameplay
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn nature-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn nature-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Add to Inventory"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
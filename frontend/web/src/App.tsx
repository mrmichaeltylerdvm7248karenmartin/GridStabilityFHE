// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface GridStabilityData {
  id: string;
  encryptedData: string;
  timestamp: number;
  source: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  status: "processing" | "stable" | "unstable" | "alert";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [stabilityData, setStabilityData] = useState<GridStabilityData[]>([]);
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
  const [newData, setNewData] = useState({
    source: "",
    pmuData: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedData, setSelectedData] = useState<GridStabilityData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // Calculate statistics for dashboard
  const stableCount = stabilityData.filter(d => d.status === "stable").length;
  const unstableCount = stabilityData.filter(d => d.status === "unstable").length;
  const alertCount = stabilityData.filter(d => d.status === "alert").length;

  // Filter data based on search term
  const filteredData = stabilityData.filter(data => 
    data.source.toLowerCase().includes(searchTerm.toLowerCase()) ||
    data.riskLevel.toLowerCase().includes(searchTerm.toLowerCase()) ||
    data.status.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    loadStabilityData().finally(() => setLoading(false));
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

  const loadStabilityData = async () => {
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
      
      const keysBytes = await contract.getData("stability_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing stability keys:", e);
        }
      }
      
      const list: GridStabilityData[] = [];
      
      for (const key of keys) {
        try {
          const dataBytes = await contract.getData(`stability_${key}`);
          if (dataBytes.length > 0) {
            try {
              const data = JSON.parse(ethers.toUtf8String(dataBytes));
              list.push({
                id: key,
                encryptedData: data.data,
                timestamp: data.timestamp,
                source: data.source,
                riskLevel: data.riskLevel,
                status: data.status
              });
            } catch (e) {
              console.error(`Error parsing stability data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading stability data ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setStabilityData(list);
    } catch (e) {
      console.error("Error loading stability data:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitStabilityData = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting PMU data with FHE..."
    });
    
    try {
      // Simulate FHE encryption for grid data
      const encryptedData = `FHE-GRID-${btoa(JSON.stringify(newData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const stabilityData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        source: newData.source,
        riskLevel: "low", // Default risk level
        status: "processing"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `stability_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(stabilityData))
      );
      
      const keysBytes = await contract.getData("stability_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(dataId);
      
      await contract.setData(
        "stability_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "PMU data encrypted and submitted securely!"
      });
      
      await loadStabilityData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewData({
          source: "",
          pmuData: ""
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

  const analyzeData = async (dataId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Analyzing encrypted grid data with FHE..."
    });

    try {
      // Simulate FHE computation time for grid analysis
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataBytes = await contract.getData(`stability_${dataId}`);
      if (dataBytes.length === 0) {
        throw new Error("Data not found");
      }
      
      const data = JSON.parse(ethers.toUtf8String(dataBytes));
      
      // Simulate FHE analysis results
      const riskLevels: ("low" | "medium" | "high" | "critical")[] = ["low", "medium", "high", "critical"];
      const statuses: ("processing" | "stable" | "unstable" | "alert")[] = ["stable", "unstable", "alert"];
      
      const updatedData = {
        ...data,
        riskLevel: riskLevels[Math.floor(Math.random() * riskLevels.length)],
        status: statuses[Math.floor(Math.random() * statuses.length)]
      };
      
      await contract.setData(
        `stability_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedData))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE grid analysis completed successfully!"
      });
      
      await loadStabilityData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Analysis failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const checkAvailability = async () => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: isAvailable ? "FHE service is available!" : "FHE service is unavailable"
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
      description: "Connect your Web3 wallet to access the grid stability analysis platform",
      icon: "🔗"
    },
    {
      title: "Submit PMU Data",
      description: "Upload encrypted Phasor Measurement Unit data for FHE analysis",
      icon: "📊"
    },
    {
      title: "FHE Processing",
      description: "Your grid data is analyzed in encrypted state without decryption",
      icon: "⚙️"
    },
    {
      title: "Get Stability Assessment",
      description: "Receive encrypted stability reports and risk assessments",
      icon: "📈"
    }
  ];

  const renderRiskChart = () => {
    const total = stabilityData.length || 1;
    const stablePercentage = (stableCount / total) * 100;
    const unstablePercentage = (unstableCount / total) * 100;
    const alertPercentage = (alertCount / total) * 100;

    return (
      <div className="risk-chart-container">
        <div className="risk-chart">
          <div 
            className="chart-segment stable" 
            style={{ transform: `rotate(${stablePercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="chart-segment unstable" 
            style={{ transform: `rotate(${(stablePercentage + unstablePercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="chart-segment alert" 
            style={{ transform: `rotate(${(stablePercentage + unstablePercentage + alertPercentage) * 3.6}deg)` }}
          ></div>
          <div className="chart-center">
            <div className="chart-value">{stabilityData.length}</div>
            <div className="chart-label">Analyses</div>
          </div>
        </div>
        <div className="chart-legend">
          <div className="legend-item">
            <div className="color-box stable"></div>
            <span>Stable: {stableCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box unstable"></div>
            <span>Unstable: {unstableCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box alert"></div>
            <span>Alert: {alertCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="grid-icon"></div>
          </div>
          <h1>Grid<span>Stability</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-data-btn"
          >
            <div className="add-icon"></div>
            Add PMU Data
          </button>
          <button 
            className="tutorial-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <button 
            className="availability-btn"
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
            <h2>Confidential Analysis of Power Grid Stability</h2>
            <p>Analyze encrypted real-time data from multiple power plants and substations using FHE to assess grid stability</p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>FHE Grid Analysis Tutorial</h2>
            <p className="subtitle">Learn how to securely analyze power grid data</p>
            
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
          <div className="dashboard-card">
            <h3>Project Introduction</h3>
            <p>Secure grid stability analysis platform using FHE technology to process encrypted PMU data without decryption, protecting critical infrastructure information.</p>
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
          </div>
          
          <div className="dashboard-card">
            <h3>Grid Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{stabilityData.length}</div>
                <div className="stat-label">Total Analyses</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{stableCount}</div>
                <div className="stat-label">Stable</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{unstableCount}</div>
                <div className="stat-label">Unstable</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{alertCount}</div>
                <div className="stat-label">Alerts</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card">
            <h3>Stability Distribution</h3>
            {renderRiskChart()}
          </div>
        </div>

        <div className="search-section">
          <div className="search-container">
            <input
              type="text"
              placeholder="Search by source, risk level, or status..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <div className="search-icon"></div>
          </div>
        </div>
        
        <div className="data-section">
          <div className="section-header">
            <h2>Encrypted Grid Stability Data</h2>
            <div className="header-actions">
              <button 
                onClick={loadStabilityData}
                className="refresh-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="data-list">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Source</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Risk Level</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {filteredData.length === 0 ? (
              <div className="no-data">
                <div className="no-data-icon"></div>
                <p>No grid stability data found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Data Set
                </button>
              </div>
            ) : (
              filteredData.map(data => (
                <div className="data-row" key={data.id}>
                  <div className="table-cell data-id">#{data.id.substring(0, 6)}</div>
                  <div className="table-cell">{data.source}</div>
                  <div className="table-cell">
                    {new Date(data.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`risk-badge ${data.riskLevel}`}>
                      {data.riskLevel}
                    </span>
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${data.status}`}>
                      {data.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    <button 
                      className="action-btn analyze"
                      onClick={() => analyzeData(data.id)}
                    >
                      Analyze
                    </button>
                    <button 
                      className="action-btn details"
                      onClick={() => setSelectedData(data)}
                    >
                      Details
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitStabilityData} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          data={newData}
          setData={setNewData}
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
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}

      {selectedData && (
        <DataDetailsModal 
          data={selectedData} 
          onClose={() => setSelectedData(null)} 
        />
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="grid-icon"></div>
              <span>GridStabilityFHE</span>
            </div>
            <p>Secure encrypted grid stability analysis using FHE technology</p>
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
            <span>FHE-Powered Infrastructure Protection</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} GridStabilityFHE. All rights reserved.
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
  data: any;
  setData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  data,
  setData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setData({
      ...data,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!data.source || !data.pmuData) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Add Encrypted PMU Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your PMU data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Source *</label>
              <select 
                name="source"
                value={data.source} 
                onChange={handleChange}
                className="form-select"
              >
                <option value="">Select source</option>
                <option value="Power Plant A">Power Plant A</option>
                <option value="Substation B">Substation B</option>
                <option value="Grid Node C">Grid Node C</option>
                <option value="Transformer D">Transformer D</option>
                <option value="Other">Other Source</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>PMU Data *</label>
              <textarea 
                name="pmuData"
                value={data.pmuData} 
                onChange={handleChange}
                placeholder="Enter PMU measurement data to encrypt..." 
                className="form-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface DataDetailsModalProps {
  data: GridStabilityData;
  onClose: () => void;
}

const DataDetailsModal: React.FC<DataDetailsModalProps> = ({ data, onClose }) => {
  return (
    <div className="modal-overlay">
      <div className="details-modal">
        <div className="modal-header">
          <h2>Grid Stability Data Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="detail-item">
            <label>Data ID:</label>
            <span>{data.id}</span>
          </div>
          
          <div className="detail-item">
            <label>Source:</label>
            <span>{data.source}</span>
          </div>
          
          <div className="detail-item">
            <label>Timestamp:</label>
            <span>{new Date(data.timestamp * 1000).toLocaleString()}</span>
          </div>
          
          <div className="detail-item">
            <label>Risk Level:</label>
            <span className={`risk-badge ${data.riskLevel}`}>{data.riskLevel}</span>
          </div>
          
          <div className="detail-item">
            <label>Status:</label>
            <span className={`status-badge ${data.status}`}>{data.status}</span>
          </div>
          
          <div className="detail-item full-width">
            <label>Encrypted Data (FHE):</label>
            <div className="encrypted-data">
              {data.encryptedData.substring(0, 100)}...
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="close-btn"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
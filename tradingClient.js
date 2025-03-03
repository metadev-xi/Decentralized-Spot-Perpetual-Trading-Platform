/**
 * Decentralized Spot & Perpetual Trading Platform
 * Core client implementation for trading functionality
 */

const { ethers } = require('ethers');
const { Connection, PublicKey, Transaction } = require('@solana/web3.js');
const { WebSocket } = require('ws');

class TradingClient {
  /**
   * Initialize the trading client
   * @param {Object} config - Configuration options
   */
  constructor(config) {
    // Basic configuration
    this.network = config.network || 'arbitrum';
    this.apiKey = config.apiKey;
    this.wallet = config.wallet;
    this.apiBaseUrl = config.apiBaseUrl || 'https://api.defiplatform.io';
    this.wsBaseUrl = config.wsBaseUrl || 'wss://ws.defiplatform.io';
    
    // State tracking
    this.positions = new Map();
    this.orders = new Map();
    this.balances = new Map();
    this.markets = new Map();
    
    // Network configuration
    this.supportedNetworks = {
      ethereum: { 
        chainId: 1,
        provider: null,
        contracts: {
          exchange: '0x1234567890abcdef1234567890abcdef12345678',
          margin: '0xabcdef1234567890abcdef1234567890abcdef12',
          vault: '0x2345678901abcdef2345678901abcdef23456789'
        }
      },
      arbitrum: { 
        chainId: 42161,
        provider: null,
        contracts: {
          exchange: '0x3456789012abcdef3456789012abcdef34567890',
          margin: '0xbcdef1234567890abcdef1234567890abcdef123',
          vault: '0x4567890123abcdef4567890123abcdef45678901'
        }
      },
      solana: {
        endpoint: 'https://api.mainnet-beta.solana.com',
        connection: null,
        programIds: {
          exchange: 'ExchGENgNJgVLFAPNPdQnkfNhCLfFNqBmz1v6mzNDJJk',
          margin: 'MrgnU9zKjwE9PaxrKroLrYm2nNKQVCVsRBzNVGxKuQA',
          vault: 'VLT8qTUTYsbXXskRJHQtLM5SoVQNWjLdcWEPsfRPaemH'
        }
      }
    };
    
    // Initialize providers
    this.initializeProviders();
    
    // Connect websocket
    this.connectWebsocket();
    
    // Fetch initial data
    this.initialize();
  }
  
  /**
   * Initialize network providers
   */
  initializeProviders() {
    // EVM networks
    if (['ethereum', 'arbitrum', 'optimism', 'bnb'].includes(this.network)) {
      const networkConfig = this.supportedNetworks[this.network];
      this.provider = new ethers.providers.JsonRpcProvider(
        this.wallet.provider || `https://rpc.${this.network}.io`
      );
      
      // Initialize contract interfaces
      this.contracts = {
        exchange: new ethers.Contract(
          networkConfig.contracts.exchange,
          require('./abis/Exchange.json'),
          this.provider
        ),
        margin: new ethers.Contract(
          networkConfig.contracts.margin,
          require('./abis/Margin.json'),
          this.provider
        ),
        vault: new ethers.Contract(
          networkConfig.contracts.vault,
          require('./abis/Vault.json'),
          this.provider
        )
      };
    } 
    // Solana
    else if (this.network === 'solana') {
      const networkConfig = this.supportedNetworks.solana;
      this.connection = new Connection(
        networkConfig.endpoint,
        'confirmed'
      );
      
      // Initialize program interfaces would be here
      // In real implementation, this would use @solana/spl-token and other libraries
    }
  }
  
  /**
   * Connect to WebSocket for real-time updates
   */
  connectWebsocket() {
    this.ws = new WebSocket(`${this.wsBaseUrl}/${this.network}`);
    
    this.ws.on('open', () => {
      console.log('WebSocket connected');
      this.authenticate();
    });
    
    this.ws.on('message', (data) => {
      const message = JSON.parse(data);
      this.handleWebSocketMessage(message);
    });
    
    this.ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
    
    this.ws.on('close', () => {
      console.log('WebSocket disconnected, reconnecting...');
      setTimeout(() => this.connectWebsocket(), 3000);
    });
  }
  
  /**
   * Authenticate with the WebSocket
   */
  authenticate() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    // Sign authentication message
    const timestamp = Date.now();
    const message = `${this.apiKey}:${timestamp}`;
    const signature = this.wallet.signMessage ? 
      this.wallet.signMessage(message) : 
      'demo-signature';
    
    this.ws.send(JSON.stringify({
      type: 'auth',
      apiKey: this.apiKey,
      timestamp,
      signature
    }));
    
    // Subscribe to relevant channels
    this.ws.send(JSON.stringify({
      type: 'subscribe',
      channels: ['orders', 'positions', 'balances', 'markets']
    }));
  }
  
  /**
   * Handle WebSocket messages
   * @param {Object} message - Message received from WebSocket
   */
  handleWebSocketMessage(message) {
    switch (message.type) {
      case 'order_update':
        this.updateOrder(message.data);
        break;
      case 'position_update':
        this.updatePosition(message.data);
        break;
      case 'balance_update':
        this.updateBalance(message.data);
        break;
      case 'market_update':
        this.updateMarket(message.data);
        break;
    }
  }
  
  /**
   * Initialize by fetching markets, balances, and positions
   */
  async initialize() {
    try {
      await Promise.all([
        this.fetchMarkets(),
        this.fetchBalances(),
        this.fetchPositions(),
        this.fetchOpenOrders()
      ]);
      console.log('Trading client initialized');
    } catch (error) {
      console.error('Initialization error:', error);
    }
  }
  
  /**
   * Fetch available markets
   */
  async fetchMarkets() {
    try {
      const response = await fetch(`${this.apiBaseUrl}/${this.network}/markets`);
      const markets = await response.json();
      
      markets.forEach(market => {
        this.markets.set(market.symbol, market);
      });
      
      return Array.from(this.markets.values());
    } catch (error) {
      console.error('Error fetching markets:', error);
      return [];
    }
  }
  
  /**
   * Fetch user balances
   */
  async fetchBalances() {
    if (!this.wallet) return [];
    
    try {
      // For EVM chains
      if (['ethereum', 'arbitrum', 'optimism', 'bnb'].includes(this.network)) {
        const walletAddress = await this.wallet.getAddress();
        const vaultContract = this.contracts.vault.connect(this.wallet);
        const tokens = await vaultContract.getUserTokens(walletAddress);
        
        await Promise.all(tokens.map(async (token) => {
          const balance = await vaultContract.getBalance(walletAddress, token);
          this.balances.set(token, {
            token,
            free: ethers.utils.formatUnits(balance.free, 18),
            locked: ethers.utils.formatUnits(balance.locked, 18),
            total: ethers.utils.formatUnits(balance.total, 18)
          });
        }));
      }
      // For Solana
      else if (this.network === 'solana') {
        // In a real implementation, this would fetch token balances for the wallet
        // This is simplified
      }
      
      return Array.from(this.balances.values());
    } catch (error) {
      console.error('Error fetching balances:', error);
      return [];
    }
  }
  
  /**
   * Fetch user positions
   */
  async fetchPositions() {
    if (!this.wallet) return [];
    
    try {
      // For EVM chains
      if (['ethereum', 'arbitrum', 'optimism', 'bnb'].includes(this.network)) {
        const walletAddress = await this.wallet.getAddress();
        const marginContract = this.contracts.margin.connect(this.wallet);
        const positions = await marginContract.getUserPositions(walletAddress);
        
        positions.forEach(position => {
          this.positions.set(position.id, {
            id: position.id,
            market: position.market,
            side: position.side === 0 ? 'long' : 'short',
            size: ethers.utils.formatUnits(position.size, 18),
            leverage: position.leverage / 100,
            entryPrice: ethers.utils.formatUnits(position.entryPrice, 8),
            liquidationPrice: ethers.utils.formatUnits(position.liquidationPrice, 8),
            margin: ethers.utils.formatUnits(position.margin, 18),
            pnl: ethers.utils.formatUnits(position.unrealizedPnl, 18),
            pnlPercentage: position.unrealizedPnlPercentage / 100
          });
        });
      }
      // For Solana
      else if (this.network === 'solana') {
        // In a real implementation, this would fetch positions from Solana program
        // This is simplified
      }
      
      return Array.from(this.positions.values());
    } catch (error) {
      console.error('Error fetching positions:', error);
      return [];
    }
  }
  
  /**
   * Fetch open orders
   */
  async fetchOpenOrders() {
    if (!this.wallet) return [];
    
    try {
      // For EVM chains
      if (['ethereum', 'arbitrum', 'optimism', 'bnb'].includes(this.network)) {
        const walletAddress = await this.wallet.getAddress();
        const exchangeContract = this.contracts.exchange.connect(this.wallet);
        const orders = await exchangeContract.getUserOrders(walletAddress);
        
        orders.forEach(order => {
          this.orders.set(order.id, {
            id: order.id,
            market: order.market,
            side: order.side === 0 ? 'buy' : 'sell',
            type: this.getOrderTypeName(order.orderType),
            price: ethers.utils.formatUnits(order.price, 8),
            amount: ethers.utils.formatUnits(order.amount, 18),
            filled: ethers.utils.formatUnits(order.filled, 18),
            status: this.getOrderStatusName(order.status),
            timestamp: order.timestamp.toNumber() * 1000
          });
        });
      }
      // For Solana
      else if (this.network === 'solana') {
        // In a real implementation, this would fetch orders from Solana program
        // This is simplified
      }
      
      return Array.from(this.orders.values());
    } catch (error) {
      console.error('Error fetching orders:', error);
      return [];
    }
  }
  
  /**
   * Create a new order
   * @param {Object} params - Order parameters
   * @returns {Promise<Object>} - Created order
   */
  async createOrder(params) {
    const {
      market,
      side,
      type,
      price,
      amount,
      leverage = 1,
      reduceOnly = false,
      timeInForce = 'GTC',
      stopPrice,
      clientOrderId = Date.now().toString()
    } = params;
    
    if (!this.wallet) {
      throw new Error('Wallet not connected');
    }
    
    try {
      let tx;
      
      // For EVM chains
      if (['ethereum', 'arbitrum', 'optimism', 'bnb'].includes(this.network)) {
        const exchangeContract = this.contracts.exchange.connect(this.wallet);
        const marketInfo = this.markets.get(market);
        
        if (!marketInfo) {
          throw new Error(`Market ${market} not found`);
        }
        
        const orderParams = {
          market: marketInfo.address,
          side: side === 'buy' ? 0 : 1,
          orderType: this.getOrderTypeId(type),
          price: ethers.utils.parseUnits(price, 8),
          amount: ethers.utils.parseUnits(amount, 18),
          leverage: Math.round(leverage * 100),
          reduceOnly,
          timeInForce: this.getTimeInForceId(timeInForce),
          stopPrice: stopPrice ? ethers.utils.parseUnits(stopPrice, 8) : 0,
          clientOrderId
        };
        
        tx = await exchangeContract.createOrder(orderParams);
        await tx.wait();
        
        // Get order ID from event logs
        const receipt = await this.provider.getTransactionReceipt(tx.hash);
        const event = receipt.logs
          .map(log => {
            try {
              return exchangeContract.interface.parseLog(log);
            } catch (e) {
              return null;
            }
          })
          .find(event => event && event.name === 'OrderCreated');
        
        const orderId = event ? event.args.orderId.toString() : 'pending';
        
        // Add to local cache
        const newOrder = {
          id: orderId,
          market,
          side,
          type,
          price,
          amount,
          filled: '0',
          status: 'open',
          timestamp: Date.now(),
          txHash: tx.hash
        };
        
        this.orders.set(orderId, newOrder);
        return newOrder;
      }
      // For Solana
      else if (this.network === 'solana') {
        // In a real implementation, this would create an order on Solana
        // This is simplified
        return {
          id: 'solana-' + Date.now(),
          market,
          side,
          type,
          price,
          amount,
          status: 'open'
        };
      }
    } catch (error) {
      console.error('Error creating order:', error);
      throw new Error(`Failed to create order: ${error.message}`);
    }
  }
  
  /**
   * Cancel an order
   * @param {string} orderId - ID of the order to cancel
   * @returns {Promise<Object>} - Cancellation result
   */
  async cancelOrder(orderId) {
    if (!this.wallet) {
      throw new Error('Wallet not connected');
    }
    
    try {
      // For EVM chains
      if (['ethereum', 'arbitrum', 'optimism', 'bnb'].includes(this.network)) {
        const exchangeContract = this.contracts.exchange.connect(this.wallet);
        const tx = await exchangeContract.cancelOrder(orderId);
        await tx.wait();
        
        // Update local cache
        const order = this.orders.get(orderId);
        if (order) {
          order.status = 'canceled';
          this.orders.set(orderId, order);
        }
        
        return {
          success: true,
          orderId,
          txHash: tx.hash
        };
      }
      // For Solana
      else if (this.network === 'solana') {
        // In a real implementation, this would cancel an order on Solana
        // This is simplified
        return {
          success: true,
          orderId
        };
      }
    } catch (error) {
      console.error('Error canceling order:', error);
      throw new Error(`Failed to cancel order: ${error.message}`);
    }
  }
  
  /**
   * Update position leverage
   * @param {string} positionId - ID of the position
   * @param {number} newLeverage - New leverage value
   * @returns {Promise<Object>} - Update result
   */
  async updatePositionLeverage(positionId, newLeverage) {
    if (!this.wallet) {
      throw new Error('Wallet not connected');
    }
    
    try {
      // For EVM chains
      if (['ethereum', 'arbitrum', 'optimism', 'bnb'].includes(this.network)) {
        const marginContract = this.contracts.margin.connect(this.wallet);
        const leverage = Math.round(newLeverage * 100); // Convert to basis points
        
        const tx = await marginContract.updatePositionLeverage(positionId, leverage);
        await tx.wait();
        
        // Update local cache
        const position = this.positions.get(positionId);
        if (position) {
          position.leverage = newLeverage;
          this.positions.set(positionId, position);
        }
        
        return {
          success: true,
          positionId,
          leverage: newLeverage,
          txHash: tx.hash
        };
      }
      // For Solana
      else if (this.network === 'solana') {
        // In a real implementation, this would update leverage on Solana
        // This is simplified
        return {
          success: true,
          positionId,
          leverage: newLeverage
        };
      }
    } catch (error) {
      console.error('Error updating position leverage:', error);
      throw new Error(`Failed to update leverage: ${error.message}`);
    }
  }
  
  /**
   * Get historical trades
   * @param {Object} params - Query parameters
   * @returns {Promise<Array>} - Historical trades
   */
  async getHistoricalTrades(params = {}) {
    const { market, limit = 50, from, to } = params;
    
    if (!this.wallet) {
      throw new Error('Wallet not connected');
    }
    
    try {
      const walletAddress = await this.wallet.getAddress();
      const queryParams = new URLSearchParams({
        address: walletAddress,
        limit: limit.toString()
      });
      
      if (market) queryParams.append('market', market);
      if (from) queryParams.append('from', from.toString());
      if (to) queryParams.append('to', to.toString());
      
      const response = await fetch(
        `${this.apiBaseUrl}/${this.network}/trades?${queryParams.toString()}`
      );
      
      return await response.json();
    } catch (error) {
      console.error('Error fetching historical trades:', error);
      return [];
    }
  }
  
  /**
   * Helper method to get order type ID
   * @param {string} typeName - Order type name
   * @returns {number} - Order type ID
   */
  getOrderTypeId(typeName) {
    const typeMap = {
      'market': 0,
      'limit': 1,
      'stop': 2,
      'stopLimit': 3,
      'trailingStop': 4
    };
    return typeMap[typeName] || 1;
  }
  
  /**
   * Helper method to get order type name
   * @param {number} typeId - Order type ID
   * @returns {string} - Order type name
   */
  getOrderTypeName(typeId) {
    const typeNames = ['market', 'limit', 'stop', 'stopLimit', 'trailingStop'];
    return typeNames[typeId] || 'unknown';
  }
  
  /**
   * Helper method to get time in force ID
   * @param {string} name - Time in force name
   * @returns {number} - Time in force ID
   */
  getTimeInForceId(name) {
    const map = {
      'GTC': 0, // Good till canceled
      'IOC': 1, // Immediate or cancel
      'FOK': 2, // Fill or kill
      'GTD': 3  // Good till date
    };
    return map[name] || 0;
  }
  
  /**
   * Helper method to get order status name
   * @param {number} statusId - Order status ID
   * @returns {string} - Order status name
   */
  getOrderStatusName(statusId) {
    const statusNames = ['open', 'filled', 'canceled', 'expired', 'rejected'];
    return statusNames[statusId] || 'unknown';
  }
  
  /**
   * Update local order data
   * @param {Object} orderData - Order data to update
   */
  updateOrder(orderData) {
    this.orders.set(orderData.id, {
      ...this.orders.get(orderData.id),
      ...orderData
    });
  }
  
  /**
   * Update local position data
   * @param {Object} positionData - Position data to update
   */
  updatePosition(positionData) {
    this.positions.set(positionData.id, {
      ...this.positions.get(positionData.id),
      ...positionData
    });
  }
  
  /**
   * Update local balance data
   * @param {Object} balanceData - Balance data to update
   */
  updateBalance(balanceData) {
    this.balances.set(balanceData.token, {
      ...this.balances.get(balanceData.token),
      ...balanceData
    });
  }
  
  /**
   * Update local market data
   * @param {Object} marketData - Market data to update
   */
  updateMarket(marketData) {
    this.markets.set(marketData.symbol, {
      ...this.markets.get(marketData.symbol),
      ...marketData
    });
  }
}

module.exports = { TradingClient };

import * as fs from 'fs';
import * as path from 'path';

const HOST_URL = 'https://sowild.fun';
const CONFIG_PATH = path.resolve(process.cwd(), 'data/config.json');

interface Config {
    api_key: string;
    wallet_address: string;
    user_id?: string;
    nickname?: string;
    balance?: number;
    is_blocked?: boolean;
    is_agent?: boolean;
}

function loadConfig(): Config {
    if (!fs.existsSync(CONFIG_PATH)) {
        console.error('Config file not found. Please create an account first using --create-account');
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(config: Config) {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(`Config saved to ${CONFIG_PATH}`);
}

async function apiRequest(endpoint: string, method: string = 'GET', body?: any, apiKey?: string) {
    const url = `${HOST_URL}${endpoint}`;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const options: RequestInit = {
        method,
        headers,
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(url, options);
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || `HTTP error! status: ${response.status}`);
        }
        return data;
    } catch (error: any) {
        console.error(`API request failed: ${error.message}`);
        process.exit(1);
    }
}

async function createAccount() {
    console.log('Creating account...');
    const result = await apiRequest('/api/agent/create_account', 'POST');
    if (result.success) {
        const config: Config = {
            api_key: result.api_key,
            wallet_address: result.wallet_address
        };
        saveConfig(config);
        console.log('Account created successfully:');
        console.log(JSON.stringify(config, null, 2));
    } else {
        console.error('Failed to create account:', result);
    }
}

async function getAccountInfo() {
    const config = loadConfig();
    console.log('Fetching account info...');
    const result = await apiRequest('/api/agent/account_info', 'GET', undefined, config.api_key);
    if (result.success && result.data) {
        const updatedConfig: Config = {
            ...config,
            ...result.data
        };
        saveConfig(updatedConfig);
    }
    console.log(JSON.stringify(result, null, 2));
}

async function updateNickname(nickname: string) {
    const config = loadConfig();
    console.log(`Updating nickname to: ${nickname}`);
    const result = await apiRequest('/api/agent/account_update', 'POST', { nickname }, config.api_key);
    if (result.success) {
        const updatedConfig: Config = {
            ...config,
            nickname: result.nickname || nickname
        };
        saveConfig(updatedConfig);
    }
    console.log(JSON.stringify(result, null, 2));
}

async function refreshBalance() {
    const config = loadConfig();
    console.log('Refreshing balance...');
    const result = await apiRequest('/api/agent/refresh_balance', 'POST', undefined, config.api_key);
    console.log(JSON.stringify(result, null, 2));
}

async function getBalanceChangeHistory() {
    const config = loadConfig();
    console.log('Fetching balance change history...');
    const result = await apiRequest('/api/agent/balance_change_history', 'GET', undefined, config.api_key);
    console.log(JSON.stringify(result, null, 2));
}

async function listGameRounds() {
    const config = loadConfig();
    console.log('Fetching game rounds...');
    const result = await apiRequest('/api/agent/round_list', 'GET', undefined, config.api_key);
    console.log(JSON.stringify(result, null, 2));
}

async function getMyParticipationHistory() {
    const config = loadConfig();
    console.log('Fetching participation history...');
    const result = await apiRequest('/api/agent/participation_list', 'GET', undefined, config.api_key);
    console.log(JSON.stringify(result, null, 2));
}

async function createWithdrawal(amount: number, targetAddress: string) {
    const config = loadConfig();
    console.log(`Creating withdrawal of ${amount} to ${targetAddress}...`);
    const result = await apiRequest('/api/agent/withdraw/create', 'POST', { amount, target_address: targetAddress }, config.api_key);
    console.log(JSON.stringify(result, null, 2));
}

async function getWithdrawalInfo(withdrawId: string) {
    const config = loadConfig();
    console.log(`Fetching withdrawal info for ID: ${withdrawId}...`);
    const result = await apiRequest(`/api/agent/withdraw/info?withdraw_id=${withdrawId}`, 'GET', undefined, config.api_key);
    console.log(JSON.stringify(result, null, 2));
}

async function listWithdrawals() {
    const config = loadConfig();
    console.log('Fetching withdrawal list...');
    const result = await apiRequest('/api/agent/withdraw/list', 'GET', undefined, config.api_key);
    console.log(JSON.stringify(result, null, 2));
}

async function main() {
    const args = process.argv.slice(2);
    const cmd = args[0];

    switch (cmd) {
        case '--create-account':
            await createAccount();
            break;
        case '--account-info':
            await getAccountInfo();
            break;
        case '--account-update':
            const nickname = args[1];
            if (!nickname) {
                console.error('Usage: --account-update <nickname>');
                process.exit(1);
            }
            await updateNickname(nickname);
            break;
        case '--refresh-balance':
            await refreshBalance();
            break;
        case '--balance-change-history':
            await getBalanceChangeHistory();
            break;
        case '--round-list':
            await listGameRounds();
            break;
        case '--participation-list':
            await getMyParticipationHistory();
            break;
        case '--withdraw-create':
            const amount = parseFloat(args[1]);
            const targetAddress = args[2];
            if (isNaN(amount) || !targetAddress) {
                console.error('Usage: --withdraw-create <amount> <target_address>');
                process.exit(1);
            }
            await createWithdrawal(amount, targetAddress);
            break;
        case '--withdraw-info':
            const withdrawId = args[1];
            if (!withdrawId) {
                console.error('Usage: --withdraw-info <withdraw_id>');
                process.exit(1);
            }
            await getWithdrawalInfo(withdrawId);
            break;
        case '--withdraw-list':
            await listWithdrawals();
            break;
        case '--help':
        default:
            console.log(`
Usage:
  --create-account                Create a new agent account
  --account-info                  View account information
  --account-update <nickname>     Update account nickname
  --refresh-balance               Refresh account balance
  --balance-change-history        View balance change history
  --round-list                    List game rounds
  --participation-list            View my participation history
  --withdraw-create <amount> <target_address>
                                  Create a withdrawal
  --withdraw-info <withdraw_id>   Get withdrawal information
  --withdraw-list                 List withdrawals
            `);
            break;
    }
}

main().catch(console.error);

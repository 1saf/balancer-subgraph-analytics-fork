import { Address, BigDecimal, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { DailyTokenSwapStatistics, Pool, PoolToken, Token, TokenPrice } from '../../types/schema';
import { BToken } from '../../types/templates/Pool/BToken';
import { BTokenBytes } from '../../types/templates/Pool/BTokenBytes';
import { LOG_SWAP } from '../../types/templates/Pool/Pool';
import { getBalancerFactory } from '../factory';
import { ZERO_BD, ZERO_BI, WETH, DAI } from '../helpers';

export function getToken(tokenAddress: Address): Token | null {
    const tokenHexAddress = tokenAddress.toHex();
    let token = Token.load(tokenHexAddress);
    const { name, symbol, decimals, totalSupply } = getERC20TokenInfo(tokenHexAddress);

    // no token was found
    // setup a new one
    if (token === null) {
        const balancer = getBalancerFactory();
        token = new Token(tokenHexAddress);
        token.balancer = balancer.id;
        token.symbol = symbol;
        token.name = name;
        token.decimals = BigInt.fromI32(decimals);

        token.totalLiquidity = ZERO_BD;
        token.txCount = ZERO_BI;
        token.swapTxCount = ZERO_BI;

        token.save();
    }

    return token;
}

type UpdateDailyTokenSwapStatisticsRequest = {};

export function updateTokenDailySwapStatistics(event: LOG_SWAP, update: UpdateDailyTokenSwapStatisticsRequest): void {
    const timestamp = event.block.timestamp.toI32();
    const dayId = timestamp / 86400;

    let currentDayStatistics = DailyTokenSwapStatistics.load(dayId.toString());

    // first event of the day, let's create a new day statistics
    // entity
    if (currentDayStatistics === null) {
    }
}

type ERC20TokenInfo = {
    name: string,
    symbol: string,
    decimals: i32,
    totalSupply: BigInt,
}

export function getERC20TokenInfo(tokenHexAddress: string = ''): ERC20TokenInfo {
    let token = BToken.bind(Address.fromString(tokenHexAddress));
    let tokenBytes = BTokenBytes.bind(Address.fromString(tokenHexAddress));
    let symbol = '';
    let name = '';
    let decimals = 18;
    let totalSupply = null;

    let symbolCall = token.try_symbol();
    let nameCall = token.try_name();
    let decimalCall = token.try_decimals();
    let totalSupplyCall = token.try_totalSupply();

    if (symbolCall.reverted) {
        let symbolBytesCall = tokenBytes.try_symbol();
        if (!symbolBytesCall.reverted) {
            symbol = symbolBytesCall.value.toString();
        }
    } else {
        symbol = symbolCall.value;
    }

    if (nameCall.reverted) {
        let nameBytesCall = tokenBytes.try_name();
        if (!nameBytesCall.reverted) {
            name = nameBytesCall.value.toString();
        }
    } else {
        name = nameCall.value;
    }

    if (!decimalCall.reverted) {
        decimals = decimalCall.value;
    }

    if (!totalSupplyCall.reverted) {
        totalSupply = totalSupplyCall.value;
    }
    return {
        name,
        symbol,
        decimals,
        totalSupply,
    };
}


type UpsertTokenPriceRequest = {
    poolLiquidity: BigDecimal,
    hasUsdPrice: boolean;
};

export function upsertTokens(tokenAddressList: Bytes[]): void {
    if (!tokenAddressList || !tokenAddressList.length) return;

    for (let i: i32 = 0; i < tokenAddressList.length; i++) {
        const tokenAddress = tokenAddressList[i];
        if (!tokenAddress) continue;

        const existingTokenEntity = Token.load(tokenAddress.toHexString());
        if (existingTokenEntity == null) {
            const newTokenEntity = new Token(tokenAddress.toHexString());

            newTokenEntity.balancer = getBalancerFactory().id;
            const { decimals, name, symbol } = getERC20TokenInfo(tokenAddress.toHexString());
            newTokenEntity.decimals = decimals;
            newTokenEntity.name = name;
            newTokenEntity.symbol = symbol;
            newTokenEntity.swapTxCount = ZERO_BI;
            newTokenEntity.txCount = ZERO_BI;
            newTokenEntity.totalLiquidity = ZERO_BD;
            
            newTokenEntity.save();
        }
    }
}

export function upsertTokenPrice(pool: Pool, { hasUsdPrice, poolLiquidity }: UpsertTokenPriceRequest): void {
    const tokensList = pool.tokensList;
    for (let i: i32 = 0; i < tokensList.length; i++) {
        let tokenPriceId = tokensList[i].toHexString();
        let tokenPrice = TokenPrice.load(tokenPriceId);
        if (tokenPrice === null) {
            tokenPrice = new TokenPrice(tokenPriceId);
            tokenPrice.poolTokenId = '';
            tokenPrice.poolLiquidity = ZERO_BD;
        }

        let poolTokenId = pool.id.concat('-').concat(tokenPriceId);
        let poolToken = PoolToken.load(poolTokenId);

        if (
            (tokenPrice.poolTokenId === poolTokenId || poolLiquidity.gt(tokenPrice.poolLiquidity)) &&
            ((tokenPriceId != WETH.toString() && tokenPriceId != DAI.toString()) ||
                (pool.tokensCount.equals(BigInt.fromI32(2)) && hasUsdPrice))
        ) {
            tokenPrice.price = ZERO_BD;

            if (poolToken.balance.gt(ZERO_BD)) {
                tokenPrice.price = poolLiquidity.div(pool.totalWeight).times(poolToken.denormWeight).div(poolToken.balance);
            }

            tokenPrice.symbol = poolToken.symbol;
            tokenPrice.name = poolToken.name;
            tokenPrice.decimals = poolToken.decimals;
            tokenPrice.poolLiquidity = poolLiquidity;
            tokenPrice.poolTokenId = poolTokenId;
            tokenPrice.save();
        }
    }
}

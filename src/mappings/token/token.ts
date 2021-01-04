import { Address, BigDecimal, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { DailyTokenStatistics, Pool, PoolToken, Token, TokenPrice } from '../../types/schema';
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

type UpdateDailyTokenStatisticsRequest = {
    token: Token;
    increaseSwapVolumeInUsdBy?: BigDecimal;
    increaseSwapTxCountBy?: number;
    increaseSwapVolumeInUnitsBy?: BigDecimal;
    increaseLiquidityInUnitsBy?: BigDecimal;
    increaseLiquidityInUsdBy?: BigDecimal;
    increaseTxCountBy?: number;
};

export function updateTokenDailyStatistics(event: ethereum.Event, {
    token,
    increaseSwapTxCountBy,
    increaseSwapVolumeInUnitsBy,
    increaseSwapVolumeInUsdBy,
    increaseLiquidityInUnitsBy,
    increaseLiquidityInUsdBy,
    increaseTxCountBy,
}: UpdateDailyTokenStatisticsRequest): DailyTokenStatistics {
    const timestamp = event.block.timestamp.toI32();
    const dayId = timestamp / 86400;
    const yesterdayDayId = dayId - 1;

    let currentDayStatistics = DailyTokenStatistics.load(dayId.toString());

    // first event of the day, let's create a new day statistics
    // entity
    if (currentDayStatistics === null) {
        const yesterdayDayStatistics = DailyTokenStatistics.load(yesterdayDayId.toString());

        currentDayStatistics = new DailyTokenStatistics(dayId.toString());

        currentDayStatistics.date = timestamp;
        currentDayStatistics.token = token.id;
        currentDayStatistics.swapVolumeInUsd = ZERO_BD;
        currentDayStatistics.swapTxCount = ZERO_BI;
        currentDayStatistics.swapVolumeInUnits = ZERO_BD;

        if (yesterdayDayStatistics && yesterdayDayStatistics.liquidityInUnits != null) {
            currentDayStatistics.liquidityInUnits = yesterdayDayStatistics.liquidityInUnits;
        } else {
            currentDayStatistics.liquidityInUnits = ZERO_BD;
        }
        if (yesterdayDayStatistics && yesterdayDayStatistics.liquidityInUsd != null) {
            currentDayStatistics.liquidityInUsd = yesterdayDayStatistics.liquidityInUsd;
        } else {
            currentDayStatistics.liquidityInUsd = ZERO_BD;
        }
        currentDayStatistics.txCount = ZERO_BI;
        currentDayStatistics.save();
    }

    if (increaseSwapTxCountBy) currentDayStatistics.swapTxCount.plus(BigInt.fromI32(increaseSwapTxCountBy));
    if (increaseSwapVolumeInUnitsBy) currentDayStatistics.swapVolumeInUnits.plus(increaseSwapVolumeInUnitsBy);
    if (increaseSwapVolumeInUsdBy) currentDayStatistics.swapVolumeInUsd.plus(increaseSwapVolumeInUsdBy);
    if (increaseLiquidityInUnitsBy) currentDayStatistics.liquidityInUnits.plus(increaseLiquidityInUnitsBy);
    if (increaseLiquidityInUsdBy) currentDayStatistics.liquidityInUsd.plus(increaseLiquidityInUsdBy);
    if (increaseTxCountBy) currentDayStatistics.txCount.plus(BigInt.fromI32(increaseTxCountBy));

    currentDayStatistics.save();
    return currentDayStatistics;
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

        // no token price exists for one of the tokens 
        // in this pool
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
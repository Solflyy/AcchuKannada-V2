/**
 * Google Play Billing wrapper (react-native-iap).
 *
 * Plan IDs defined here must match what you create in the Google Play Console.
 * - Subscriptions (base plan IDs): weekly / monthly / yearly
 * - One-time in-app products:       3months / 6months / lifetime
 *
 * After a successful purchase we persist "@acchu_pro" = "true" in AsyncStorage
 * and acknowledge / finish the transaction so Google doesn't refund it.
 */
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  initConnection,
  endConnection,
  getSubscriptions,
  getProducts,
  requestSubscription,
  requestPurchase,
  finishTransaction,
  getAvailablePurchases,
  purchaseUpdatedListener,
  purchaseErrorListener,
  flushFailedPurchasesCachedAsPendingAndroid,
  type Product,
  type Subscription,
  type Purchase,
  type SubscriptionAndroid,
} from 'react-native-iap';

/** Product IDs — create these in Play Console with matching IDs. */
export const SUBSCRIPTION_SKUS = ['weekly', 'monthly', 'yearly'] as const;
export const INAPP_SKUS        = ['lifetime'] as const;

export type PlanId = typeof SUBSCRIPTION_SKUS[number] | typeof INAPP_SKUS[number];

export const PRO_STORAGE_KEY = '@acchu_pro';

let connected = false;
let updateSub: { remove: () => void } | null = null;
let errorSub:  { remove: () => void } | null = null;

/** Mark the user as Pro locally. */
async function grantPro() {
  try { await AsyncStorage.setItem(PRO_STORAGE_KEY, 'true'); } catch {}
}

/**
 * Initialise billing, register listeners, and fetch products.
 * Call once near app startup. Safe to call multiple times.
 *
 * onPurchased — called after a successful + acknowledged purchase.
 */
export async function initBilling(onPurchased?: (p: Purchase) => void): Promise<{
  subs: Subscription[];
  products: Product[];
}> {
  if (Platform.OS !== 'android') return { subs: [], products: [] };

  if (!connected) {
    try {
      await initConnection();
      connected = true;
    } catch (e) {
      console.warn('[billing] initConnection failed', e);
      return { subs: [], products: [] };
    }
    try { await flushFailedPurchasesCachedAsPendingAndroid(); } catch {}
  }

  // Remove any prior listeners before re-attaching.
  updateSub?.remove(); errorSub?.remove();

  updateSub = purchaseUpdatedListener(async (purchase: Purchase) => {
    const token = (purchase as any).purchaseToken;
    if (!token) return;
    try {
      await grantPro();
      // isConsumable = false for both subs and the lifetime/3-6-month entitlements.
      await finishTransaction({ purchase, isConsumable: false });
      onPurchased?.(purchase);
    } catch (e) {
      console.warn('[billing] finishTransaction failed', e);
    }
  });

  errorSub = purchaseErrorListener((err) => {
    // User cancel is code "E_USER_CANCELLED" — silent.
    if (err?.code === 'E_USER_CANCELLED') return;
    console.warn('[billing] purchase error', err);
    Alert.alert('ಖರೀದಿ ವಿಫಲವಾಗಿದೆ', err?.message || 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.');
  });

  let subs: Subscription[] = [];
  let products: Product[] = [];
  try {
    subs = await getSubscriptions({ skus: [...SUBSCRIPTION_SKUS] });
  } catch (e) { console.warn('[billing] getSubscriptions failed', e); }
  try {
    products = await getProducts({ skus: [...INAPP_SKUS] });
  } catch (e) { console.warn('[billing] getProducts failed', e); }

  return { subs, products };
}

/** Launch the Play purchase sheet for a given plan. */
export async function buyPlan(planId: PlanId): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!connected) await initBilling();

  if ((SUBSCRIPTION_SKUS as readonly string[]).includes(planId)) {
    // Subscription — need the first base-plan offerToken on Android.
    const subs = (await getSubscriptions({ skus: [planId] })) as SubscriptionAndroid[];
    const sub = subs.find((s) => s.productId === planId);
    const offerToken = sub?.subscriptionOfferDetails?.[0]?.offerToken;
    if (!offerToken) throw new Error('No offer token available for ' + planId);
    await requestSubscription({
      sku: planId,
      subscriptionOffers: [{ sku: planId, offerToken }],
    });
  } else {
    // react-native-iap requires ALL skus to be fetched together to populate
    // the internal cache — fetching a single sku alone often returns empty.
    const allProducts = await getProducts({ skus: [...INAPP_SKUS] });
    const found = allProducts.find((p) => p.productId === planId);
    if (!found) {
      throw new Error(
        `Product "${planId}" not found. Make sure it is Active in Play Console and your account is a licensed tester.`
      );
    }
    await requestPurchase({ sku: planId });
  }
}

/**
 * Restore — fetch any active subscription or non-consumed in-app purchase.
 * Returns true if the user owns Pro.
 */
export async function restorePurchases(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (!connected) await initBilling();
  try {
    const owned = await getAvailablePurchases();
    const hasAny = owned.some(p => {
      const id = (p as any).productId;
      return (SUBSCRIPTION_SKUS as readonly string[]).includes(id)
          || (INAPP_SKUS as readonly string[]).includes(id);
    });
    if (hasAny) {
      await grantPro();
      // Acknowledge any unacknowledged purchases.
      for (const p of owned) {
        try { await finishTransaction({ purchase: p, isConsumable: false }); } catch {}
      }
    }
    return hasAny;
  } catch (e) {
    console.warn('[billing] restore failed', e);
    return false;
  }
}

/** Tear down — usually not needed, the app keeps the connection for its lifetime. */
export async function shutdownBilling() {
  updateSub?.remove(); updateSub = null;
  errorSub?.remove();  errorSub  = null;
  if (connected) {
    try { await endConnection(); } catch {}
    connected = false;
  }
}

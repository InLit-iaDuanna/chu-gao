"use client";

import QRCode from "qrcode";
import {
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Ticket,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, IconButton, Input } from "@/components/ui";
import { cn } from "@/lib/utils";

import { isApiError, redeemCode } from "./lib/api";
import { useWorkspaceNavigation } from "./WorkspaceShell";
import {
  completeBrowserOrder,
  createBrowserCheckout,
  getBrowserContext,
  getConfig,
  getOrder,
  getStorefrontOrderResultUrl,
  isStorefrontApiError,
  isStorefrontVerificationError,
  prepareBrowserOrder,
  queryBrowserOrder,
  verifyBrowserOrder,
  type StorefrontBrowserCheckout,
  type StorefrontBrowserExternalOrder,
  type StorefrontRechargeConfig,
  type StorefrontRechargeOrder,
} from "./storefront-recharge-api";

const ORDER_KEY = "chugao.storefront.order";
const CHECKOUT_KEY = "chugao.storefront.checkout";
const VERIFY_INTERVAL_MS = 8_000;
const CREDIT_TIERS = [100, 500, 1000, 2000, 5000, 10000];
const STATUS_LABELS: Record<string, string> = {
  PENDING: "待支付",
  PAID: "正在核对积分",
  COMPLETED: "已到账",
  EXPIRED: "已过期",
  FAILED: "处理失败",
};

interface PendingCheckout {
  order_id: string;
  attempted: true;
  external?: StorefrontBrowserExternalOrder;
}

function terminal(status: string) {
  return ["COMPLETED", "EXPIRED", "FAILED"].includes(status);
}

function withExpiry(order: StorefrontRechargeOrder): StorefrontRechargeOrder {
  return !terminal(order.status) && Date.parse(order.expires_at) <= Date.now()
    ? { ...order, status: "EXPIRED" }
    : order;
}

function safeExternalUrl(raw?: string): string {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ["wzyp.cn", "pay.ldxp.cn"].includes(url.hostname.toLowerCase())
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Payment and redemption still work when browser storage is unavailable.
  }
}

function readPendingCheckout(orderId: string): PendingCheckout | null {
  try {
    const saved: PendingCheckout | null = JSON.parse(
      readStorage(CHECKOUT_KEY) ?? "null",
    );
    const external = saved?.external;
    if (saved?.order_id === orderId && saved.attempted === true && !external)
      return saved;
    if (
      saved?.order_id !== orderId ||
      !external ||
      !/^[A-Za-z0-9_-]{3,160}$/.test(external.trade_no) ||
      !safeExternalUrl(external.pay_url) ||
      !Number.isFinite(external.amount) ||
      !Number.isInteger(external.channel_id) ||
      external.amount <= 0 ||
      external.channel_id <= 0
    )
      return null;
    return { ...saved, attempted: true };
  } catch {
    return null;
  }
}

function closeBlankPopup(popup: Window | null) {
  try {
    if (popup && !popup.closed && popup.location.href === "about:blank")
      popup.close();
  } catch {
    // A popup that already navigated belongs to the payment provider.
  }
}

function reservePopup(message: string): Window | null {
  let popup: Window | null = null;
  try {
    popup = window.open(
      "about:blank",
      "_blank",
      "popup,width=560,height=820,resizable=yes,scrollbars=yes",
    );
    if (popup) {
      // Retain the async redirect handle while severing access to this app.
      popup.opener = null;
      popup.document.title = "链动小铺";
      popup.document.body.textContent = message;
    }
    return popup;
  } catch {
    closeBlankPopup(popup);
    return null;
  }
}

function navigatePopup(popup: Window | null, raw: string): boolean {
  const url = safeExternalUrl(raw);
  if (!url) throw new Error("支付链接无效，请重新查询订单。");
  try {
    if (!popup || popup.closed) return false;
    popup.location.replace(url);
    return true;
  } catch {
    return false;
  }
}

export function StorefrontRechargeView() {
  const router = useRouter();
  const { refreshBalance } = useWorkspaceNavigation();
  const [config, setConfig] = useState<StorefrontRechargeConfig | null>(null);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [order, setOrder] = useState<StorefrontRechargeOrder | null>(null);
  const [checkout, setCheckout] = useState<StorefrontBrowserCheckout | null>(
    null,
  );
  const [selectedCredits, setSelectedCredits] = useState(100);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verificationUrl, setVerificationUrl] = useState("");
  const [orderQueryUrl, setOrderQueryUrl] = useState("");
  const mounted = useRef(true);
  const orderRef = useRef<StorefrontRechargeOrder | null>(null);
  const checkoutRef = useRef<StorefrontBrowserCheckout | null>(null);
  const pendingCheckout = useRef<PendingCheckout | null>(null);
  const creationInFlight = useRef(false);
  const verifyInFlight = useRef(false);
  const redeemInFlight = useRef(false);
  const browserBlocked = useRef(false);
  const refreshedOrder = useRef<string | null>(null);
  const paymentPopup = useRef<Window | null>(null);
  const resultPopup = useRef<Window | null>(null);

  const updateOrder = useCallback((value: StorefrontRechargeOrder) => {
    const next = withExpiry(value);
    orderRef.current = next;
    setOrder(next);
    if (terminal(next.status) || next.payment_trade_no) {
      pendingCheckout.current = null;
      writeStorage(CHECKOUT_KEY, null);
    }
    return next;
  }, []);

  const reportError = useCallback((caught: unknown, fallback: string) => {
    if (!mounted.current) return;
    if (isStorefrontVerificationError(caught)) {
      browserBlocked.current = true;
      setVerificationUrl(safeExternalUrl(caught.verificationUrl));
      setOrderQueryUrl(safeExternalUrl(caught.orderQueryUrl));
    }
    setError(caught instanceof Error ? caught.message : fallback);
  }, []);

  const refreshAccount = useCallback(async () => {
    router.refresh();
    try {
      await refreshBalance();
    } catch {
      if (mounted.current)
        setError("积分已到账，余额暂时无法刷新，请刷新页面查看。");
    }
  }, [refreshBalance, router]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      closeBlankPopup(paymentPopup.current);
      closeBlankPopup(resultPopup.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getConfig()
      .then((loaded) => {
        if (cancelled) return;
        setConfig(loaded);
        const first = loaded.products.find(
          (product) =>
            CREDIT_TIERS.includes(product.credits) &&
            product.price === product.credits / 100,
        );
        if (first)
          setSelectedCredits((current) =>
            loaded.products.some((product) => product.credits === current)
              ? current
              : first.credits,
          );
      })
      .catch((caught) => {
        if (!cancelled)
          reportError(caught, "充值服务暂时无法读取，请稍后重试。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [configAttempt, reportError]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const savedId = readStorage(ORDER_KEY);
      try {
        if (!savedId) return;
        const saved = await getOrder(savedId);
        if (cancelled) return;
        const restored = updateOrder(saved);
        setSelectedCredits(restored.credits);
        if (terminal(restored.status)) return;
        pendingCheckout.current = readPendingCheckout(savedId);
        if (pendingCheckout.current && !pendingCheckout.current.external)
          browserBlocked.current = true;
        const context = await getBrowserContext(savedId);
        if (cancelled) return;
        checkoutRef.current = context;
        setCheckout(context);
      } catch (caught) {
        if (cancelled) return;
        if (isStorefrontApiError(caught) && caught.status === 404) {
          writeStorage(ORDER_KEY, null);
          writeStorage(CHECKOUT_KEY, null);
        }
        reportError(caught, "上次订单暂时无法读取，可重新查询或兑换卡密。");
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportError, updateOrder]);

  useEffect(() => {
    if (
      order?.status !== "COMPLETED" ||
      refreshedOrder.current === order.order_id
    )
      return;
    refreshedOrder.current = order.order_id;
    setMessage("充值已到账。");
    const context = checkoutRef.current;
    if (context && order.payment_trade_no) {
      try {
        navigatePopup(
          resultPopup.current,
          getStorefrontOrderResultUrl(context, order.payment_trade_no),
        );
      } catch (caught) {
        reportError(caught, "订单结果页暂时无法刷新，请重新打开。");
      }
    }
    void refreshAccount();
  }, [
    order?.order_id,
    order?.status,
    order?.payment_trade_no,
    refreshAccount,
    reportError,
  ]);

  const activeOrder = Boolean(order && !terminal(order.status));
  const paymentUrl = activeOrder ? safeExternalUrl(order?.pay_url) : "";
  const selectedProduct = config?.products.find(
    (product) =>
      product.credits === selectedCredits &&
      product.price === selectedCredits / 100 &&
      product.currency === "CNY",
  );
  const needsManualCheckout =
    activeOrder &&
    pendingCheckout.current?.order_id === order?.order_id &&
    !pendingCheckout.current?.external;
  const configuredItemUrl =
    selectedProduct &&
    "item_url" in selectedProduct &&
    typeof selectedProduct.item_url === "string"
      ? safeExternalUrl(selectedProduct.item_url)
      : "";
  const itemUrl = safeExternalUrl(checkout?.item_url) || configuredItemUrl;
  const resultUrl = useMemo(() => {
    if (!checkout || !order?.payment_trade_no) return "";
    try {
      return safeExternalUrl(
        getStorefrontOrderResultUrl(checkout, order.payment_trade_no),
      );
    } catch {
      return "";
    }
  }, [checkout, order?.payment_trade_no]);

  useEffect(() => {
    let cancelled = false;
    setQrDataUrl("");
    if (paymentUrl) {
      void QRCode.toDataURL(paymentUrl, {
        width: 220,
        margin: 1,
        color: { dark: "#111827", light: "#ffffff" },
      })
        .then((data) => {
          if (!cancelled) setQrDataUrl(data);
        })
        .catch(() => {
          if (!cancelled) {
            setQrDataUrl("");
            setError(
              (current) =>
                current ?? "二维码暂时无法生成，请打开支付页继续支付。",
            );
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [paymentUrl]);

  const verifyCurrent = useCallback(
    async (showPending = true) => {
      const current = orderRef.current;
      if (
        !current ||
        terminal(current.status) ||
        verifyInFlight.current ||
        creationInFlight.current ||
        redeemInFlight.current
      )
        return;
      verifyInFlight.current = true;
      setVerifying(true);
      if (showPending) setError(null);
      const isCurrent = () =>
        mounted.current && orderRef.current?.order_id === current.order_id;
      try {
        const latest = await getOrder(current.order_id);
        if (!isCurrent()) return;
        const refreshed = updateOrder(latest);
        if (terminal(refreshed.status)) return;
        if (
          !refreshed.payment_trade_no ||
          (browserBlocked.current && !showPending)
        ) {
          if (showPending)
            setMessage("订单尚未完成核对，也可以输入小铺卡密兑换积分。");
          return;
        }
        let context = checkoutRef.current;
        if (!context) {
          context = await getBrowserContext(current.order_id);
          if (!isCurrent()) return;
          checkoutRef.current = context;
          setCheckout(context);
        }
        const detail = await queryBrowserOrder(
          context,
          refreshed.payment_trade_no,
        );
        if (!isCurrent() || terminal(orderRef.current!.status)) return;
        if (detail.status === 1 && detail.cards.length > 0) {
          const settled = await verifyBrowserOrder(current.order_id, detail);
          if (!isCurrent()) return;
          updateOrder(settled);
          setError(null);
          browserBlocked.current = false;
          setMessage(
            settled.status === "COMPLETED"
              ? "充值已到账。"
              : "已收到小铺结果，正在核对积分。",
          );
        } else if (showPending) setMessage("订单还在等待支付或小铺发卡。");
      } catch (caught) {
        if (isCurrent())
          reportError(caught, "订单核对失败，请稍后重试或兑换卡密。");
      } finally {
        verifyInFlight.current = false;
        if (mounted.current) setVerifying(false);
      }
    },
    [reportError, updateOrder],
  );

  useEffect(() => {
    const currentOrder = orderRef.current;
    if (!currentOrder || terminal(currentOrder.status)) return;
    const id = currentOrder.order_id;
    const timer = window.setInterval(
      () => void verifyCurrent(false),
      VERIFY_INTERVAL_MS,
    );
    const remaining = Date.parse(currentOrder.expires_at) - Date.now();
    const expiryTimer = Number.isFinite(remaining)
      ? window.setTimeout(
          () => {
            const current = orderRef.current;
            if (current?.order_id === id && !terminal(current.status))
              updateOrder({ ...current, status: "EXPIRED" });
          },
          Math.max(0, Math.min(remaining, 2_147_483_647)),
        )
      : null;
    return () => {
      window.clearInterval(timer);
      if (expiryTimer !== null) window.clearTimeout(expiryTimer);
    };
  }, [
    order?.order_id,
    order?.status,
    order?.expires_at,
    verifyCurrent,
    updateOrder,
  ]);

  async function createOrder(requestedCredits = selectedCredits) {
    const product = config?.products.find(
      (item) =>
        item.credits === requestedCredits &&
        item.price === requestedCredits / 100 &&
        item.currency === "CNY",
    );
    if (
      !product ||
      creationInFlight.current ||
      verifyInFlight.current ||
      redeemInFlight.current
    )
      return;
    setSelectedCredits(requestedCredits);
    if (
      orderRef.current &&
      !terminal(orderRef.current.status) &&
      orderRef.current.payment_trade_no
    )
      return;
    creationInFlight.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    setVerificationUrl("");
    setOrderQueryUrl("");
    const popup = reservePopup("正在准备支付订单…");
    const result = reservePopup("正在准备小铺订单页…");
    paymentPopup.current = popup;
    resultPopup.current = result;
    try {
      let current = orderRef.current;
      let context = checkoutRef.current;
      const savedId = readStorage(ORDER_KEY);
      if (!current && savedId) {
        const saved = await getOrder(savedId);
        if (!mounted.current) return;
        current = updateOrder(saved);
        setSelectedCredits(current.credits);
        pendingCheckout.current = readPendingCheckout(savedId);
      }
      if (current && !terminal(current.status) && current.payment_trade_no) {
        if (current.pay_url) navigatePopup(popup, current.pay_url);
        if (!context) {
          context = await getBrowserContext(current.order_id);
          if (!mounted.current) return;
          checkoutRef.current = context;
          setCheckout(context);
        }
        navigatePopup(
          result,
          getStorefrontOrderResultUrl(context, current.payment_trade_no),
        );
        setMessage("已恢复已有支付订单，请继续支付或核对积分。");
        return;
      }
      if (!current || terminal(withExpiry(current).status)) {
        const prepared = await prepareBrowserOrder(requestedCredits);
        if (!mounted.current) return;
        current = updateOrder(prepared.order);
        browserBlocked.current = false;
        context = prepared.checkout;
        checkoutRef.current = context;
        setCheckout(context);
        writeStorage(ORDER_KEY, current.order_id);
        pendingCheckout.current = null;
        writeStorage(CHECKOUT_KEY, null);
      } else if (!context) {
        context = await getBrowserContext(current.order_id);
        if (!mounted.current) return;
        checkoutRef.current = context;
        setCheckout(context);
      }
      if (!context || terminal(withExpiry(current).status))
        throw new Error("订单已结束，请重新选择充值额度。");
      let external =
        pendingCheckout.current?.order_id === current.order_id
          ? pendingCheckout.current.external
          : undefined;
      if (!external) {
        if (pendingCheckout.current?.order_id === current.order_id) {
          navigatePopup(popup, context.item_url);
          setMessage("请在官方商品页确认已有订单，收到卡密后兑换积分。");
          return;
        }
        // A lost upstream response is ambiguous; resume through the official shop instead of purchasing twice.
        pendingCheckout.current = {
          order_id: current.order_id,
          attempted: true,
        };
        writeStorage(CHECKOUT_KEY, JSON.stringify(pendingCheckout.current));
        external = await createBrowserCheckout(context);
        if (!safeExternalUrl(external.pay_url))
          throw new Error("支付链接无效，请前往官方商品页。");
        external = {
          trade_no: external.trade_no,
          pay_url: external.pay_url,
          amount: external.amount,
          channel_id: external.channel_id,
        };
        pendingCheckout.current = {
          order_id: current.order_id,
          attempted: true,
          external,
        };
        // Persist payment references only; never persist card codes or query passwords.
        writeStorage(CHECKOUT_KEY, JSON.stringify(pendingCheckout.current));
      }
      const bound = await completeBrowserOrder(current.order_id, external);
      pendingCheckout.current = null;
      writeStorage(CHECKOUT_KEY, null);
      if (!mounted.current) return;
      const next = updateOrder(bound);
      const resultOpened = navigatePopup(
        result,
        getStorefrontOrderResultUrl(
          context,
          next.payment_trade_no || external.trade_no,
        ),
      );
      if (!terminal(next.status)) {
        const opened = navigatePopup(popup, next.pay_url || external.pay_url);
        setMessage(
          opened && resultOpened
            ? "支付页和小铺订单页已打开，等待支付与积分核对。"
            : "订单已创建，可使用下方按钮打开支付页和小铺订单页。",
        );
      }
    } catch (caught) {
      if (!mounted.current) return;
      reportError(caught, "创建订单失败，请重试或前往官方商品页购买卡密。");
      if (isStorefrontVerificationError(caught)) {
        const officialUrl = safeExternalUrl(checkoutRef.current?.item_url);
        if (officialUrl) navigatePopup(popup, officialUrl);
      }
    } finally {
      closeBlankPopup(popup);
      closeBlankPopup(result);
      creationInFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function resetOrder() {
    if (
      creationInFlight.current ||
      verifyInFlight.current ||
      redeemInFlight.current
    )
      return;
    orderRef.current = null;
    checkoutRef.current = null;
    pendingCheckout.current = null;
    browserBlocked.current = false;
    setOrder(null);
    setCheckout(null);
    setMessage(null);
    setError(null);
    setVerificationUrl("");
    setOrderQueryUrl("");
    writeStorage(ORDER_KEY, null);
    writeStorage(CHECKOUT_KEY, null);
  }

  async function redeemCard() {
    const trimmed = code.trim();
    if (
      !trimmed ||
      redeemInFlight.current ||
      creationInFlight.current ||
      verifyInFlight.current
    )
      return;
    redeemInFlight.current = true;
    setRedeeming(true);
    setError(null);
    setMessage(null);
    try {
      const result = await redeemCode(trimmed);
      if (!mounted.current) return;
      setCode("");
      browserBlocked.current = true;
      setMessage(
        `兑换成功，已到账 ${result.credits} 积分，当前余额 ${result.balance} 积分。`,
      );
      await refreshAccount();
    } catch (caught) {
      if (mounted.current)
        setError(
          isApiError(caught) ? caught.message : "卡密兑换失败，请稍后重试。",
        );
    } finally {
      redeemInFlight.current = false;
      if (mounted.current) setRedeeming(false);
    }
  }

  return (
    <div className="min-w-0 space-y-5 [overflow-wrap:anywhere]">
      {error ? (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/5 p-4 text-sm text-danger"
        >
          <p>{error}</p>
          {verificationUrl || orderQueryUrl ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {verificationUrl ? (
                <Button asChild size="sm">
                  <a
                    href={verificationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4" />
                    打开验证页
                  </a>
                </Button>
              ) : null}
              {orderQueryUrl ? (
                <Button asChild size="sm">
                  <a
                    href={orderQueryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4" />
                    小铺订单查询
                  </a>
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p role="status" className="text-sm leading-6 text-foreground">
          {message}
        </p>
      ) : null}

      <section
        className="surface-panel min-w-0 p-4 sm:p-6"
        aria-labelledby="recharge-heading"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="recharge-heading" className="text-base font-semibold">
              充值
            </h2>
            <p className="mt-2 text-sm text-text-muted">1 元 = 100 积分</p>
          </div>
          <ShieldCheck
            className="h-5 w-5 shrink-0 text-foreground"
            strokeWidth={1.7}
          />
        </div>
        {loading || restoring ? (
          <p
            role="status"
            className="mt-6 flex items-center gap-2 text-sm text-text-muted"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            正在读取充值信息…
          </p>
        ) : config?.enabled ? (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {CREDIT_TIERS.map((credits) => {
                const product = config.products.find(
                  (item) =>
                    item.credits === credits &&
                    item.price === credits / 100 &&
                    item.currency === "CNY",
                );
                return (
                  <button
                    key={credits}
                    type="button"
                    aria-pressed={selectedCredits === credits}
                    disabled={!product || busy || redeeming || activeOrder}
                    onClick={() => void createOrder(credits)}
                    className={cn(
                      "min-w-0 rounded-lg border px-3 py-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-foreground disabled:cursor-not-allowed disabled:opacity-60",
                      selectedCredits === credits
                        ? "border-foreground bg-foreground/5"
                        : "border-border hover:border-border-strong",
                    )}
                  >
                    <span className="block text-lg font-semibold tabular-nums">
                      {credits.toLocaleString("zh-CN")}
                    </span>
                    <span className="mt-1 block text-xs text-text-muted">
                      积分
                    </span>
                    <span className="mt-3 block font-mono text-sm">
                      ¥{(credits / 100).toFixed(2)}
                    </span>
                    {!product ? (
                      <span className="mt-1 block text-xs text-text-faint">
                        暂不可用
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {needsManualCheckout && itemUrl && !busy ? (
              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <Button
                  asChild
                  variant="secondary"
                  className="w-full sm:w-auto"
                >
                  <a href={itemUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                    打开官方商品页
                  </a>
                </Button>
              </div>
            ) : null}
            {config.payment_tip ? (
              <p className="mt-3 text-xs leading-5 text-text-muted">
                {config.payment_tip}
              </p>
            ) : null}
          </>
        ) : (
          <div className="mt-5 text-sm text-text-muted">
            <p>
              {config
                ? "在线充值暂未开放，已有卡密仍可兑换。"
                : "充值档位暂时无法读取，已有卡密仍可兑换。"}
            </p>
            <Button
              className="mt-3"
              size="sm"
              onClick={() => {
                setError(null);
                setConfigAttempt((attempt) => attempt + 1);
              }}
            >
              <RefreshCw className="h-4 w-4" />
              重新加载
            </Button>
          </div>
        )}
      </section>

      {order ? (
        <section
          className="surface-panel min-w-0 p-4 sm:p-6"
          aria-labelledby="order-heading"
        >
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="order-heading" className="text-sm font-medium">
                订单状态：{STATUS_LABELS[order.status] ?? "等待核对"}
              </h2>
              <p className="mt-1 break-all text-xs text-text-muted">
                订单号 {order.order_id}
              </p>
            </div>
            <IconButton
              variant="ghost"
              title="检查支付结果"
              aria-label="检查支付结果"
              className="h-9 w-9 shrink-0"
              onClick={() => void verifyCurrent(true)}
              disabled={verifying || busy || redeeming || !activeOrder}
            >
              <RefreshCw
                className={cn("h-4 w-4", verifying && "animate-spin")}
              />
            </IconButton>
          </div>
          <div
            className={cn(
              "mt-5 grid min-w-0 gap-5",
              paymentUrl && "md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]",
            )}
          >
            {paymentUrl ? (
              <div className="w-full max-w-[220px] rounded-lg bg-white p-3">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="支付二维码"
                    className="aspect-square w-full"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center text-sm text-gray-500">
                    二维码暂未生成
                  </div>
                )}
                <p className="mt-2 text-center text-xs text-gray-500">
                  使用手机扫码支付
                </p>
              </div>
            ) : null}
            <div className="flex min-w-0 flex-col gap-4">
              <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
                <dt className="text-text-muted">到账积分</dt>
                <dd>{order.credits.toLocaleString("zh-CN")} 积分</dd>
                <dt className="text-text-muted">应付金额</dt>
                <dd className="font-mono">¥{order.pay_amount.toFixed(2)}</dd>
                <dt className="text-text-muted">账户标识</dt>
                <dd className="break-all">{order.contact || "—"}</dd>
                <dt className="text-text-muted">有效期</dt>
                <dd>
                  {Number.isFinite(Date.parse(order.expires_at))
                    ? new Date(order.expires_at).toLocaleString("zh-CN")
                    : "以小铺订单页为准"}
                </dd>
              </dl>
              <div className="mt-auto flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {paymentUrl ? (
                  <Button asChild>
                    <a
                      href={paymentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-4 w-4" />
                      打开支付页
                    </a>
                  </Button>
                ) : null}
                {resultUrl ? (
                  <Button asChild>
                    <a
                      href={resultUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => {
                        if (!resultPopup.current || resultPopup.current.closed)
                          resultPopup.current =
                            reservePopup("正在打开小铺订单页…");
                        if (navigatePopup(resultPopup.current, resultUrl))
                          event.preventDefault();
                      }}
                    >
                      <ExternalLink className="h-4 w-4" />
                      小铺订单页
                    </a>
                  </Button>
                ) : null}
                {terminal(order.status) ? (
                  <Button
                    onClick={resetOrder}
                    disabled={verifying || busy || redeeming}
                  >
                    <RefreshCw className="h-4 w-4" />
                    重新选择
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section
        className="surface-panel min-w-0 p-4 sm:p-6"
        aria-labelledby="redeem-heading"
      >
        <h2
          id="redeem-heading"
          className="flex items-center gap-2 text-base font-semibold"
        >
          <Ticket className="h-4 w-4 text-text-muted" />
          卡密兑换
        </h2>
        <p className="mt-2 text-sm leading-6 text-text-muted">
          在链动小铺购买后，可使用收到的卡密兑换积分。
        </p>
        <form
          className="mt-4 flex min-w-0 flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void redeemCard();
          }}
        >
          <Input
            aria-label="充值卡密"
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="h-10 min-h-10 min-w-0 font-mono sm:flex-1"
            placeholder="输入充值卡密"
            value={code}
            disabled={redeeming}
            onChange={(event) => setCode(event.target.value)}
          />
          <Button
            type="submit"
            variant="secondary"
            className="h-10"
            disabled={!code.trim() || busy || verifying || restoring}
            loading={redeeming}
          >
            <Ticket className="h-4 w-4" />
            兑换积分
          </Button>
        </form>
      </section>
    </div>
  );
}

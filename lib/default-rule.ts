import { ParseRule } from "@/lib/types";

export const BLANK_RULE: ParseRule = {
  name: "新解析规则",
  version: 2,
  source: "any",
  sheetMode: "all",
  defaults: {},
  common: {},
  strategies: [
    {
      type: "table",
      enabled: true,
      sheets: "all",
      header: {
        findByKeywords: ["编码", "名称", "数量"],
        maxScanRows: 20
      },
      dataStartRowOffset: 1,
      columns: {
        externalCode: { candidates: ["外部编码", "单据号", "配送单号", "订单号"] },
        storeName: { candidates: ["收货门店", "收货机构", "门店", "机构"] },
        receiverName: { candidates: ["收件人", "收货人", "联系人"] },
        receiverPhone: { candidates: ["电话", "联系电话", "收货电话"] },
        receiverAddress: { candidates: ["地址", "收货地址"] },
        skuCode: { candidates: ["物品编码", "SKU编码", "商品编码", "编码"] },
        skuName: { candidates: ["物品名称", "SKU名称", "商品名称", "名称"] },
        quantity: { candidates: ["发货数量", "出库数量", "数量"] },
        spec: { candidates: ["规格型号", "规格"] },
        remark: { candidates: ["备注"] }
      },
      skipRowsWhen: { textMatches: ["合计", "总计"], requiredAny: ["skuCode", "skuName", "quantity"] }
    }
  ]
};

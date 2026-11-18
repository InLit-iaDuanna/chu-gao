import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  ActivityTrail,
  NO_CREDIT_CHARGE,
  TurnCredits,
} from "./ChatReplyBubbles";

it("shows chat, image, and combined actual charges with sub-credit precision", () => {
  render(
    <TurnCredits
      chat={{ state: "charged", chargedCredits: 0.734531 }}
      image={{ state: "charged", chargedCredits: 17 }}
    />,
  );
  expect(screen.getByLabelText("本轮积分")).toHaveTextContent(
    "聊天实际积分：0.734531",
  );
  expect(screen.getByLabelText("本轮积分")).toHaveTextContent(
    "生图实际积分：17",
  );
  expect(screen.getByLabelText("本轮积分")).toHaveTextContent(
    "合计：17.734531 积分",
  );
});

it("distinguishes holds, unknown usage, image refunds, and missing records", () => {
  const view = render(
    <TurnCredits
      chat={{ state: "reserved", chargedCredits: null, reservedCredits: 12 }}
      image={NO_CREDIT_CHARGE}
    />,
  );
  expect(screen.getByLabelText("本轮积分")).toHaveTextContent(
    "待结算（已预留 12）",
  );
  expect(screen.getByLabelText("本轮积分")).toHaveTextContent("合计：待结算");
  view.rerender(
    <TurnCredits
      chat={{ state: "usage_unknown", chargedCredits: 0 }}
      image={{ state: "charged", chargedCredits: 7 }}
    />,
  );
  expect(screen.getByLabelText("本轮积分")).toHaveTextContent(
    "聊天实际积分：0（用量未确认，未扣费）",
  );
  expect(screen.getByLabelText("本轮积分")).toHaveTextContent("合计：7 积分");
  view.rerender(
    <TurnCredits
      chat={{ state: "released", chargedCredits: 0 }}
      image={{ state: "refunded", chargedCredits: 0, refundedCredits: 7 }}
    />,
  );
  expect(screen.getByLabelText("本轮积分")).toHaveTextContent(
    "生图实际积分：0（已退 7）",
  );
  view.rerender(<TurnCredits image={NO_CREDIT_CHARGE} />);
  expect(screen.getByLabelText("本轮积分")).toHaveTextContent(
    "聊天实际积分：待确认",
  );
});

it("does not label an interrupted prose stream as completed", () => {
  render(
    <ActivityTrail
      active={false}
      status="interrupted"
      history={["image_tool", "waiting_upstream"]}
    />,
  );
  expect(screen.getByText("文字回复未完成")).toBeVisible();
  expect(screen.queryByText(/已完成 ·/)).not.toBeInTheDocument();
});

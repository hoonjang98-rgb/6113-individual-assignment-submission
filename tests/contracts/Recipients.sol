// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import "../../contracts/FreelancePay.sol";

/// @dev Test-only issuer used to exercise recipient rejection and callbacks.
contract TestRecipient {
    FreelancePay public immutable target;
    uint8 public mode;
    uint256 public invoiceId;
    bool public callbackSucceeded;
    bytes public callbackData;

    constructor(address target_) { target = FreelancePay(target_); }

    function issue(address client, uint256 amountWei, string calldata invoiceReference)
        external returns (uint256)
    {
        invoiceId = target.createInvoice(client, amountWei, invoiceReference);
        return invoiceId;
    }

    function setMode(uint8 mode_) external { mode = mode_; }
    function cancel() external { target.cancelInvoice(invoiceId); }

    receive() external payable {
        if (mode == 1) revert("Recipient rejected payment");
        if (mode == 2) {
            (callbackSucceeded, callbackData) = address(target).call(
                abi.encodeCall(target.cancelInvoice, (invoiceId))
            );
        }
        if (mode == 3) {
            (callbackSucceeded, callbackData) = address(target).call(
                abi.encodeCall(target.createInvoice, (address(0x1234), 1, "CALLBACK"))
            );
        }
    }
}

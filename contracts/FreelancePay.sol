// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

/// @title FreelancePay
/// @notice Educational exact-value invoice payments. Use test funds only.
contract FreelancePay {
    enum Status { Pending, Paid, Cancelled }

    struct Invoice {
        address issuer;
        address client;
        uint256 amountWei;
        string invoiceReference;
        uint64 createdAt;
        uint64 settledAt;
        uint64 createdBlock;
        uint64 settledBlock;
        Status status;
    }

    error InvalidClient();
    error InvalidAmount();
    error InvalidReference();
    error InvoiceNotFound();
    error Unauthorized();
    error InvalidState();
    error IncorrectValue();
    error TransferFailed();
    error ReentrantCall();
    error InvalidPagination();

    event InvoiceCreated(
        uint256 indexed invoiceId, address indexed issuer, address indexed client,
        uint256 amountWei, string invoiceReference
    );
    event InvoicePaid(
        uint256 indexed invoiceId, address indexed issuer, address indexed client,
        uint256 amountWei
    );
    event InvoiceCancelled(uint256 indexed invoiceId, address indexed issuer);

    uint256 public invoiceCount;
    mapping(uint256 => Invoice) private _invoices;
    mapping(address => uint256[]) private _issued;
    mapping(address => uint256[]) private _received;
    uint256 private _guard = 1;

    modifier nonReentrant() {
        if (_guard != 1) revert ReentrantCall();
        _guard = 2;
        _;
        _guard = 1;
    }

    function createInvoice(address client, uint256 amountWei, string calldata invoiceReference)
        external nonReentrant returns (uint256 invoiceId)
    {
        if (client == address(0) || client == msg.sender) revert InvalidClient();
        if (amountWei == 0) revert InvalidAmount();
        _validateReference(invoiceReference);

        invoiceId = ++invoiceCount;
        _invoices[invoiceId] = Invoice({
            issuer: msg.sender,
            client: client,
            amountWei: amountWei,
            invoiceReference: invoiceReference,
            createdAt: uint64(block.timestamp),
            settledAt: 0,
            createdBlock: uint64(block.number),
            settledBlock: 0,
            status: Status.Pending
        });
        _issued[msg.sender].push(invoiceId);
        _received[client].push(invoiceId);
        emit InvoiceCreated(invoiceId, msg.sender, client, amountWei, invoiceReference);
    }

    function payInvoice(uint256 invoiceId) external payable nonReentrant {
        Invoice storage invoice = _existingInvoice(invoiceId);
        if (msg.sender != invoice.client) revert Unauthorized();
        if (invoice.status != Status.Pending) revert InvalidState();
        if (msg.value != invoice.amountWei) revert IncorrectValue();

        invoice.status = Status.Paid;
        invoice.settledAt = uint64(block.timestamp);
        invoice.settledBlock = uint64(block.number);
        (bool success, ) = payable(invoice.issuer).call{value: msg.value}("");
        if (!success) revert TransferFailed();
        emit InvoicePaid(invoiceId, invoice.issuer, invoice.client, invoice.amountWei);
    }

    function cancelInvoice(uint256 invoiceId) external nonReentrant {
        Invoice storage invoice = _existingInvoice(invoiceId);
        if (msg.sender != invoice.issuer) revert Unauthorized();
        if (invoice.status != Status.Pending) revert InvalidState();
        invoice.status = Status.Cancelled;
        invoice.settledAt = uint64(block.timestamp);
        invoice.settledBlock = uint64(block.number);
        emit InvoiceCancelled(invoiceId, msg.sender);
    }

    function getInvoice(uint256 invoiceId) external view returns (Invoice memory) {
        return _existingInvoice(invoiceId);
    }

    function getInvoiceIds(address account, bool issued, uint256 offset, uint256 limit)
        external view returns (uint256[] memory ids, uint256 total)
    {
        if (account == address(0)) revert InvalidClient();
        if (limit == 0 || limit > 50) revert InvalidPagination();
        uint256[] storage source = issued ? _issued[account] : _received[account];
        total = source.length;
        if (offset >= total) return (new uint256[](0), total);
        uint256 size = total - offset;
        if (size > limit) size = limit;
        ids = new uint256[](size);
        for (uint256 i; i < size; ++i) ids[i] = source[total - 1 - offset - i];
    }

    function _existingInvoice(uint256 invoiceId) private view returns (Invoice storage invoice) {
        if (invoiceId == 0 || invoiceId > invoiceCount) revert InvoiceNotFound();
        return _invoices[invoiceId];
    }

    function _validateReference(string calldata invoiceReference) private pure {
        bytes calldata value = bytes(invoiceReference);
        if (value.length == 0 || value.length > 32) revert InvalidReference();
        if (value[0] == 0x20 || value[value.length - 1] == 0x20) revert InvalidReference();
        for (uint256 i; i < value.length; ++i) {
            if (value[i] < 0x20 || value[i] > 0x7e) revert InvalidReference();
        }
    }
}

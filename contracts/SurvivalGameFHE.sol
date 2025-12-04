// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SurvivalGameFHE is SepoliaConfig {
    struct EncryptedPlayer {
        uint256 playerId;
        euint32 encryptedPositionX;    // Encrypted X coordinate
        euint32 encryptedPositionY;      // Encrypted Y coordinate
        euint32 encryptedHealth;        // Encrypted health status
        euint32 encryptedResources;     // Encrypted resource count
        uint256 lastActionTime;
    }

    struct EncryptedAction {
        euint32 encryptedActionType;    // Encrypted action identifier
        euint32 encryptedDirection;     // Encrypted movement direction
        euint32 encryptedTargetId;      // Encrypted target player/item ID
    }

    struct DecryptedOutcome {
        string resultMessage;
        string newPosition;
        string resourcesGained;
        bool isRevealed;
    }

    uint256 public playerCount;
    mapping(uint256 => EncryptedPlayer) public encryptedPlayers;
    mapping(uint256 => EncryptedAction) public encryptedActions;
    mapping(uint256 => DecryptedOutcome) public decryptedOutcomes;
    
    mapping(string => euint32) private encryptedZoneCount;
    string[] private zoneList;
    
    mapping(uint256 => uint256) private requestToPlayerId;

    event PlayerRegistered(uint256 indexed playerId, uint256 timestamp);
    event ActionSubmitted(uint256 indexed playerId);
    event OutcomeRevealed(uint256 indexed playerId, string result);

    modifier onlyPlayer(uint256 playerId) {
        // Access control for players would be implemented here
        _;
    }

    function registerEncryptedPlayer(
        euint32 encryptedPositionX,
        euint32 encryptedPositionY,
        euint32 encryptedHealth,
        euint32 encryptedResources,
        string memory startingZone
    ) public {
        playerCount += 1;
        uint256 newId = playerCount;
        
        encryptedPlayers[newId] = EncryptedPlayer({
            playerId: newId,
            encryptedPositionX: encryptedPositionX,
            encryptedPositionY: encryptedPositionY,
            encryptedHealth: encryptedHealth,
            encryptedResources: encryptedResources,
            lastActionTime: block.timestamp
        });

        decryptedOutcomes[newId] = DecryptedOutcome({
            resultMessage: "",
            newPosition: "",
            resourcesGained: "",
            isRevealed: false
        });

        if (FHE.isInitialized(encryptedZoneCount[startingZone]) == false) {
            encryptedZoneCount[startingZone] = FHE.asEuint32(0);
            zoneList.push(startingZone);
        }
        encryptedZoneCount[startingZone] = FHE.add(
            encryptedZoneCount[startingZone],
            FHE.asEuint32(1)
        );

        emit PlayerRegistered(newId, block.timestamp);
    }

    function submitEncryptedAction(
        uint256 playerId,
        euint32 encryptedActionType,
        euint32 encryptedDirection,
        euint32 encryptedTargetId
    ) public onlyPlayer(playerId) {
        require(playerId <= playerCount, "Invalid player ID");
        
        encryptedActions[playerId] = EncryptedAction({
            encryptedActionType: encryptedActionType,
            encryptedDirection: encryptedDirection,
            encryptedTargetId: encryptedTargetId
        });

        bytes32[] memory ciphertexts = prepareActionData(playerId);
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.processGameAction.selector);
        requestToPlayerId[reqId] = playerId;

        emit ActionSubmitted(playerId);
    }

    function processGameAction(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 playerId = requestToPlayerId[requestId];
        require(playerId != 0, "Invalid request");
        
        DecryptedOutcome storage outcome = decryptedOutcomes[playerId];
        require(!outcome.isRevealed, "Already processed");

        FHE.checkSignatures(requestId, cleartexts, proof);

        string[] memory actionData = abi.decode(cleartexts, (string[]));
        
        outcome.resultMessage = determineActionResult(actionData);
        outcome.newPosition = calculateNewPosition(actionData);
        outcome.resourcesGained = calculateResourceGain(actionData);
        outcome.isRevealed = true;

        updateZoneStatistics(actionData[4]);

        emit OutcomeRevealed(playerId, outcome.resultMessage);
    }

    function getActionOutcome(uint256 playerId) public view returns (
        string memory resultMessage,
        string memory newPosition,
        string memory resourcesGained,
        bool isRevealed
    ) {
        DecryptedOutcome storage o = decryptedOutcomes[playerId];
        return (o.resultMessage, o.newPosition, o.resourcesGained, o.isRevealed);
    }

    function requestZoneCountDecryption(string memory zoneName) public onlyPlayer(bytes32ToUint(keccak256(abi.encodePacked(zoneName)))) {
        euint32 count = encryptedZoneCount[zoneName];
        require(FHE.isInitialized(count), "Zone not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(count);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptZoneCount.selector);
        requestToPlayerId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(zoneName)));
    }

    function decryptZoneCount(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 zoneHash = requestToPlayerId[requestId];
        string memory zoneName = getZoneFromHash(zoneHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 count = abi.decode(cleartexts, (uint32));
    }

    function prepareActionData(uint256 playerId) private view returns (bytes32[] memory) {
        EncryptedPlayer storage player = encryptedPlayers[playerId];
        EncryptedAction storage action = encryptedActions[playerId];

        bytes32[] memory ciphertexts = new bytes32[](7);
        ciphertexts[0] = FHE.toBytes32(player.encryptedPositionX);
        ciphertexts[1] = FHE.toBytes32(player.encryptedPositionY);
        ciphertexts[2] = FHE.toBytes32(player.encryptedHealth);
        ciphertexts[3] = FHE.toBytes32(player.encryptedResources);
        ciphertexts[4] = FHE.toBytes32(action.encryptedActionType);
        ciphertexts[5] = FHE.toBytes32(action.encryptedDirection);
        ciphertexts[6] = FHE.toBytes32(action.encryptedTargetId);

        return ciphertexts;
    }

    function determineActionResult(string[] memory data) private pure returns (string memory) {
        return "Successfully gathered resources";
    }

    function calculateNewPosition(string[] memory data) private pure returns (string memory) {
        return "X:123,Y:456";
    }

    function calculateResourceGain(string[] memory data) private pure returns (string memory) {
        return "+5 food, +3 materials";
    }

    function updateZoneStatistics(string memory zoneName) private {
        if (FHE.isInitialized(encryptedZoneCount[zoneName]) == false) {
            encryptedZoneCount[zoneName] = FHE.asEuint32(0);
            zoneList.push(zoneName);
        }
        encryptedZoneCount[zoneName] = FHE.add(
            encryptedZoneCount[zoneName], 
            FHE.asEuint32(1)
        );
    }

    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }

    function getZoneFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < zoneList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(zoneList[i]))) == hash) {
                return zoneList[i];
            }
        }
        revert("Zone not found");
    }
}